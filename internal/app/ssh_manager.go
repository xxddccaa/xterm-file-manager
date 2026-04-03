package app

import (
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log"
	"net"
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

// SSHSession represents an active SSH session
type SSHSession struct {
	ID                   string
	Config               SSHConfigEntry
	ResolvedConfig       *ResolvedSSHConfig
	Client               *ssh.Client
	ProxyClients         []*ssh.Client
	AgentHandle          *sshAgentHandle
	Connected            bool
	ConnectAt            time.Time
	LastActive           time.Time
	LastServerInfoSample *sshServerInfoSample
	mu                   sync.RWMutex
}

// SSHManager manages all SSH connections
type SSHManager struct {
	sessions map[string]*SSHSession
	mu       sync.RWMutex
}

var sshManager = &SSHManager{
	sessions: make(map[string]*SSHSession),
}

const (
	SSHPasswordRequiredPrefix = "SSH_PASSWORD_REQUIRED:"
	SSHPasswordInvalidPrefix  = "SSH_PASSWORD_INVALID:"
)

// FileInfo represents file/directory information
type FileInfo struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Mode    string `json:"mode"`
	ModTime string `json:"modTime"`
	IsDir   bool   `json:"isDir"`
}

func knownHostsCallback() ssh.HostKeyCallback {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		log.Printf("⚠️ Failed to resolve home directory for known_hosts: %v", err)
		return func(string, net.Addr, ssh.PublicKey) error { return nil }
	}
	return knownHostsCallbackWithPaths([]string{filepath.Join(homeDir, ".ssh", "known_hosts")})
}

func knownHostsCallbackWithPaths(paths []string) ssh.HostKeyCallback {
	cleanPaths := make([]string, 0, len(paths))
	existingPaths := make([]string, 0, len(paths))
	for _, path := range uniqueStrings(paths) {
		path = strings.TrimSpace(path)
		if path == "" {
			continue
		}
		cleanPaths = append(cleanPaths, path)
		if _, err := os.Stat(path); err == nil {
			existingPaths = append(existingPaths, path)
		} else if !os.IsNotExist(err) {
			log.Printf("⚠️ Failed to inspect known_hosts file %s: %v", path, err)
		}
	}

	var baseCallback ssh.HostKeyCallback
	if len(existingPaths) > 0 {
		callback, err := knownhosts.New(existingPaths...)
		if err != nil {
			log.Printf("⚠️ Failed to parse known_hosts files %v: %v", existingPaths, err)
		} else {
			baseCallback = callback
		}
	}

	targetPath := ""
	if len(cleanPaths) > 0 {
		targetPath = cleanPaths[0]
	}

	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		hostLabel := hostname
		if host, _, err := net.SplitHostPort(hostname); err == nil && host != "" {
			hostLabel = host
		}

		fingerprint := sha256.Sum256(key.Marshal())
		fpStr := base64.StdEncoding.EncodeToString(fingerprint[:])

		if baseCallback != nil {
			if err := baseCallback(hostname, remote, key); err != nil {
				var keyErr *knownhosts.KeyError
				if errors.As(err, &keyErr) {
					if len(keyErr.Want) > 0 {
						return fmt.Errorf("host key mismatch for %s (fingerprint SHA256:%s). Remove the old entry from %s to proceed", hostLabel, fpStr, strings.Join(existingPaths, ", "))
					}
				} else {
					return err
				}
			} else {
				return nil
			}
		}

		if targetPath == "" {
			return nil
		}

		log.Printf("🔐 New host key for %s (SHA256:%s)", hostLabel, fpStr)
		if err := appendKnownHost(targetPath, hostname, key); err != nil {
			log.Printf("⚠️ Failed to append known_hosts entry for %s: %v", hostLabel, err)
		}
		return nil
	}
}

func appendKnownHost(knownHostsPath, hostname string, key ssh.PublicKey) error {
	dir := filepath.Dir(knownHostsPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	f, err := os.OpenFile(knownHostsPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	line := knownhosts.Line([]string{knownhosts.Normalize(hostname)}, key)
	_, err = f.WriteString(line + "\n")
	return err
}

// ConnectSSH establishes SSH connection
func (a *App) ConnectSSH(config SSHConfigEntry) (string, error) {
	return a.connectSSH(config, sshPromptInputs{})
}

// ConnectSSHWithPassword establishes SSH connection with an explicit password.
func (a *App) ConnectSSHWithPassword(config SSHConfigEntry, password string) (string, error) {
	return a.connectSSH(config, sshPromptInputs{
		Password:     password,
		PasswordHost: config.Host,
	})
}

// ConnectSSHWithAuth retries an SSH connection with a prompt-provided secret.
func (a *App) ConnectSSHWithAuth(config SSHConfigEntry, password string, passwordHost string, keyPassphrase string, keyIdentityFile string) (string, error) {
	return a.connectSSH(config, sshPromptInputs{
		Password:        password,
		PasswordHost:    passwordHost,
		KeyPassphrase:   keyPassphrase,
		KeyIdentityFile: keyIdentityFile,
	})
}

// ClearSSHPasswordCache removes cached SSH passwords and key passphrases.
func (a *App) ClearSSHPasswordCache() error {
	return clearSSHPasswordCache()
}

func applyResolvedConfigFallbacks(config SSHConfigEntry, resolved *ResolvedSSHConfig) {
	if resolved.Alias == "" {
		resolved.Alias = config.Host
	}
	if resolved.Hostname == "" {
		if config.Hostname != "" {
			resolved.Hostname = config.Hostname
		} else {
			resolved.Hostname = resolved.Alias
		}
	}
	if resolved.User == "" {
		if config.User != "" {
			resolved.User = config.User
		} else if currentUser, err := user.Current(); err == nil {
			resolved.User = currentUser.Username
		}
	}
	if resolved.Port == 0 {
		if config.Port > 0 {
			resolved.Port = config.Port
		} else {
			resolved.Port = 22
		}
	}
	if len(resolved.IdentityFiles) == 0 && config.IdentityFile != "" {
		resolved.IdentityFiles = []string{config.IdentityFile}
	}
}

func cachePromptPasswordOnSuccess(prompt sshPromptInputs) {
	if prompt.Password == "" || strings.TrimSpace(prompt.PasswordHost) == "" {
		return
	}

	entry := SSHConfigEntry{
		Host:     prompt.PasswordHost,
		Hostname: prompt.PasswordHost,
		Port:     22,
	}

	if resolved, err := resolveSSHConfig(prompt.PasswordHost); err == nil {
		applyResolvedConfigFallbacks(entry, resolved)
		entry = sshConfigEntryFromResolved(resolved)
	}

	if err := cacheSSHPassword(entry, prompt.Password); err != nil {
		log.Printf("⚠️ Failed to cache SSH password for %s: %v", entry.Host, err)
	}
}

func (a *App) connectSSH(config SSHConfigEntry, prompt sshPromptInputs) (string, error) {
	resolved, err := resolveSSHConfig(config.Host)
	if err != nil {
		return "", err
	}
	applyResolvedConfigFallbacks(config, resolved)

	sessionID := fmt.Sprintf("%s-%d", resolved.Alias, time.Now().UnixNano())
	client, proxyClients, agentHandle, err := connectResolvedSSHChain(resolved, prompt, nil, resolved.ForwardAgent)
	if err != nil {
		return "", err
	}

	if prompt.Password != "" {
		cachePromptPasswordOnSuccess(prompt)
	}

	storedConfig := sshConfigEntryFromResolved(resolved)
	if config.ID != "" {
		storedConfig.ID = config.ID
	}

	session := &SSHSession{
		ID:             sessionID,
		Config:         storedConfig,
		ResolvedConfig: resolved,
		Client:         client,
		ProxyClients:   proxyClients,
		AgentHandle:    agentHandle,
		Connected:      true,
		ConnectAt:      time.Now(),
		LastActive:     time.Now(),
	}

	sshManager.mu.Lock()
	sshManager.sessions[sessionID] = session
	sshManager.mu.Unlock()

	return sessionID, nil
}

func isSSHAuthenticationError(err error) bool {
	if err == nil {
		return false
	}

	errMsg := strings.ToLower(err.Error())
	return strings.Contains(errMsg, "unable to authenticate") ||
		strings.Contains(errMsg, "no supported methods remain") ||
		strings.Contains(errMsg, "permission denied")
}

// DisconnectSSH closes an SSH connection
func (a *App) DisconnectSSH(sessionID string) error {
	// Clean up cached SFTP client first
	closeSFTPClient(sessionID)

	sshManager.mu.Lock()
	defer sshManager.mu.Unlock()

	session, exists := sshManager.sessions[sessionID]
	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	if session.Client != nil {
		_ = session.Client.Close()
	}
	closeSSHClients(session.ProxyClients)
	if session.AgentHandle != nil {
		_ = session.AgentHandle.Close()
	}

	session.Connected = false
	delete(sshManager.sessions, sessionID)

	return nil
}

// ExecuteCommand executes a command on the remote server
func (a *App) ExecuteCommand(sessionID string, command string) (string, error) {
	sshManager.mu.RLock()
	session, exists := sshManager.sessions[sessionID]
	sshManager.mu.RUnlock()

	if !exists {
		return "", fmt.Errorf("session not found: %s", sessionID)
	}

	if !session.Connected || session.Client == nil {
		return "", fmt.Errorf("session not connected")
	}

	// Create new SSH session for command execution
	sshSession, err := session.Client.NewSession()
	if err != nil {
		return "", fmt.Errorf("failed to create SSH session: %v", err)
	}
	defer sshSession.Close()

	// Execute command
	output, err := sshSession.CombinedOutput(command)
	if err != nil {
		return string(output), fmt.Errorf("command failed: %v", err)
	}

	session.mu.Lock()
	session.LastActive = time.Now()
	session.mu.Unlock()

	return string(output), nil
}

// ListFiles lists files in a directory via SFTP
func (a *App) ListFiles(sessionID string, path string) ([]FileInfo, error) {
	// Get SFTP client
	sftpClient, err := getSFTPClient(sessionID)
	if err != nil {
		return nil, fmt.Errorf("failed to create SFTP client: %v", err)
	}
	// SFTP client is managed by pool, do not close here

	// Resolve special paths (., ~, ~/...)
	if path == "" || path == "~" || path == "." {
		workingDir, err := sftpClient.Getwd()
		if err != nil {
			return nil, fmt.Errorf("failed to get remote working directory: %v", err)
		}
		path = workingDir
	} else if strings.HasPrefix(path, "~/") {
		homeDir, err := sftpClient.Getwd()
		if err != nil {
			return nil, fmt.Errorf("failed to get remote home directory: %v", err)
		}
		path = homeDir + path[1:]
	} else if strings.HasPrefix(path, "./") {
		workingDir, err := sftpClient.Getwd()
		if err != nil {
			return nil, fmt.Errorf("failed to get remote working directory: %v", err)
		}
		path = workingDir + path[1:]
	}

	// Read directory via SFTP
	entries, err := sftpClient.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read remote directory: %v", err)
	}

	// Convert to FileInfo
	var files []FileInfo
	for _, entry := range entries {
		// Skip . and ..
		if entry.Name() == "." || entry.Name() == ".." {
			continue
		}

		fileInfo := FileInfo{
			Name:    entry.Name(),
			Size:    entry.Size(),
			Mode:    entry.Mode().String(),
			ModTime: entry.ModTime().Format(time.RFC3339),
			IsDir:   entry.IsDir(),
		}
		files = append(files, fileInfo)
	}

	return files, nil
}

// GetCurrentDirectory gets the current working directory
func (a *App) GetCurrentDirectory(sessionID string) (string, error) {
	return a.ExecuteCommand(sessionID, "pwd")
}

// CreatePTY creates a pseudo-terminal session.
// Deprecated: This function is legacy code and should not be used.
// Use StartTerminalSession or StartLocalTerminalSession instead.
// This method has goroutine leak issues and is kept only for compatibility.
func (a *App) CreatePTY(sessionID string) error {
	return fmt.Errorf("CreatePTY is deprecated - use StartTerminalSession or StartLocalTerminalSession")
}
