package app

import (
	"fmt"
	"io"
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

// ConnectSSH establishes SSH connection
func (a *App) ConnectSSH(config SSHConfigEntry) (string, error) {
	sessionID := fmt.Sprintf("%s-%d", config.Host, time.Now().Unix())

	// Build SSH client config
	sshConfig := &ssh.ClientConfig{
		User:            config.User,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(), // TODO: Implement proper host key verification
		Timeout:         10 * time.Second,
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
	defer sftpClient.Close()

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

// CreatePTY creates a pseudo-terminal session
func (a *App) CreatePTY(sessionID string) error {
	sshManager.mu.RLock()
	session, exists := sshManager.sessions[sessionID]
	sshManager.mu.RUnlock()

	if !exists {
		return fmt.Errorf("session not found: %s", sessionID)
	}

	if !session.Connected || session.Client == nil {
		return fmt.Errorf("session not connected")
	}

	// Create new SSH session for PTY
	sshSession, err := session.Client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create SSH session: %v", err)
	}

	// Request PTY
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	if err := sshSession.RequestPty("xterm-256color", 40, 80, modes); err != nil {
		sshSession.Close()
		return fmt.Errorf("failed to request PTY: %v", err)
	}

	// Get stdin/stdout/stderr
	stdin, err := sshSession.StdinPipe()
	if err != nil {
		sshSession.Close()
		return fmt.Errorf("failed to get stdin: %v", err)
	}

	stdout, err := sshSession.StdoutPipe()
	if err != nil {
		sshSession.Close()
		return fmt.Errorf("failed to get stdout: %v", err)
	}

	stderr, err := sshSession.StderrPipe()
	if err != nil {
		sshSession.Close()
		return fmt.Errorf("failed to get stderr: %v", err)
	}

	// Start shell
	if err := sshSession.Shell(); err != nil {
		sshSession.Close()
		return fmt.Errorf("failed to start shell: %v", err)
	}

	// Handle I/O in goroutines
	go func() {
		io.Copy(os.Stdout, stdout)
	}()

	go func() {
		io.Copy(os.Stderr, stderr)
	}()

	go func() {
		io.Copy(stdin, os.Stdin)
	}()

	// Wait for session to end
	go func() {
		sshSession.Wait()
		sshSession.Close()
	}()

	return nil
}
