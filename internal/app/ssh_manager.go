package app

import (
	"bufio"
	"crypto/sha256"
	"encoding/base64"
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
)

// SSHSession represents an active SSH session
type SSHSession struct {
	ID         string
	Config     SSHConfigEntry
	Client     *ssh.Client
	Connected  bool
	ConnectAt  time.Time
	LastActive time.Time
	mu         sync.RWMutex
}

// SSHManager manages all SSH connections
type SSHManager struct {
	sessions map[string]*SSHSession
	mu       sync.RWMutex
}

var sshManager = &SSHManager{
	sessions: make(map[string]*SSHSession),
}

// FileInfo represents file/directory information
type FileInfo struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Mode    string `json:"mode"`
	ModTime string `json:"modTime"`
	IsDir   bool   `json:"isDir"`
}

// knownHostsCallback returns an ssh.HostKeyCallback that implements TOFU
// (Trust On First Use) - same behavior as OpenSSH:
// - If host exists in ~/.ssh/known_hosts, verify the key matches
// - If host is new, accept the key and append it to known_hosts
func knownHostsCallback() ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		usr, err := user.Current()
		if err != nil {
			// Cannot determine home dir, fall back to trust
			log.Printf("Warning: cannot get current user for known_hosts check: %v", err)
			return nil
		}

		knownHostsPath := filepath.Join(usr.HomeDir, ".ssh", "known_hosts")

		// Normalize hostname (strip port if it's default 22)
		host, port, _ := net.SplitHostPort(hostname)
		if host == "" {
			host = hostname
		}

		// Build the host key fingerprint for logging
		fingerprint := sha256.Sum256(key.Marshal())
		fpStr := base64.StdEncoding.EncodeToString(fingerprint[:])

		// Try to find existing entry in known_hosts
		found, mismatch := checkKnownHost(knownHostsPath, host, port, key)

		if mismatch {
			return fmt.Errorf("host key mismatch for %s (fingerprint SHA256:%s). "+
				"This may indicate a man-in-the-middle attack. "+
				"Remove the old entry from %s to proceed", host, fpStr, knownHostsPath)
		}

		if found {
			// Key matches known_hosts entry
			return nil
		}

		// TOFU: host not in known_hosts, accept and record
		log.Printf("New host key for %s (SHA256:%s), adding to known_hosts", host, fpStr)
		if err := appendKnownHost(knownHostsPath, host, port, key); err != nil {
			log.Printf("Warning: failed to write known_hosts: %v", err)
			// Still allow connection even if we can't write known_hosts
		}
		return nil
	}
}

// checkKnownHost checks if a host key exists in known_hosts.
// Returns (found, mismatch): found=true if host exists with matching key,
// mismatch=true if host exists but key differs.
func checkKnownHost(knownHostsPath, host, port string, key ssh.PublicKey) (found bool, mismatch bool) {
	f, err := os.Open(knownHostsPath)
	if err != nil {
		return false, false // File doesn't exist or can't open
	}
	defer f.Close()

	keyType := key.Type()
	keyData := base64.StdEncoding.EncodeToString(key.Marshal())

	// Build possible host patterns to match
	hostPatterns := []string{host}
	if port != "" && port != "22" {
		hostPatterns = append(hostPatterns, fmt.Sprintf("[%s]:%s", host, port))
	}

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}

		lineHosts := strings.Split(fields[0], ",")
		lineKeyType := fields[1]
		lineKeyData := fields[2]

		// Check if any of our host patterns match this line
		for _, pattern := range hostPatterns {
			for _, lh := range lineHosts {
				if strings.TrimSpace(lh) == pattern {
					// Host found - check if key matches
					if lineKeyType == keyType && lineKeyData == keyData {
						return true, false // Exact match
					}
					if lineKeyType == keyType {
						return false, true // Same type, different key = mismatch
					}
					// Different key type, continue searching
				}
			}
		}
	}

	return false, false
}

// appendKnownHost appends a new host key entry to known_hosts file
func appendKnownHost(knownHostsPath, host, port string, key ssh.PublicKey) error {
	// Ensure .ssh directory exists
	dir := filepath.Dir(knownHostsPath)
	if err := os.MkdirAll(dir, 0700); err != nil {
		return err
	}

	f, err := os.OpenFile(knownHostsPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return err
	}
	defer f.Close()

	// Format: hostname key-type base64-key
	hostEntry := host
	if port != "" && port != "22" {
		hostEntry = fmt.Sprintf("[%s]:%s", host, port)
	}

	keyData := base64.StdEncoding.EncodeToString(key.Marshal())
	line := fmt.Sprintf("%s %s %s\n", hostEntry, key.Type(), keyData)

	_, err = f.WriteString(line)
	return err
}

// ConnectSSH establishes SSH connection
func (a *App) ConnectSSH(config SSHConfigEntry) (string, error) {
	sessionID := fmt.Sprintf("%s-%d", config.Host, time.Now().Unix())

	// Build SSH client config with known_hosts verification (TOFU strategy)
	sshConfig := &ssh.ClientConfig{
		User:            config.User,
		HostKeyCallback: knownHostsCallback(),
		Timeout:         SSHConnectTimeout * time.Second,
	}

	// Handle authentication
	if config.IdentityFile != "" {
		// Expand ~ to home directory
		identityFile := config.IdentityFile
		if strings.HasPrefix(identityFile, "~/") {
			usr, err := user.Current()
			if err == nil {
				identityFile = filepath.Join(usr.HomeDir, identityFile[2:])
			}
		}

		// Read private key
		key, err := os.ReadFile(identityFile)
		if err != nil {
			return "", fmt.Errorf("failed to read private key: %v", err)
		}

		// Parse private key
		signer, err := ssh.ParsePrivateKey(key)
		if err != nil {
			return "", fmt.Errorf("failed to parse private key: %v", err)
		}

		sshConfig.Auth = []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		}
	} else {
		return "", fmt.Errorf("no authentication method configured")
	}

	// Determine hostname
	hostname := config.Hostname
	if hostname == "" {
		hostname = config.Host
	}

	// Connect to SSH server
	addr := fmt.Sprintf("%s:%d", hostname, config.Port)
	client, err := ssh.Dial("tcp", addr, sshConfig)
	if err != nil {
		return "", fmt.Errorf("failed to connect to %s: %v", addr, err)
	}

	// Create session object
	session := &SSHSession{
		ID:         sessionID,
		Config:     config,
		Client:     client,
		Connected:  true,
		ConnectAt:  time.Now(),
		LastActive: time.Now(),
	}

	// Store session
	sshManager.mu.Lock()
	sshManager.sessions[sessionID] = session
	sshManager.mu.Unlock()

	return sessionID, nil
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
		session.Client.Close()
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
