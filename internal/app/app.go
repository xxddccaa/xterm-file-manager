package app

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App struct
type App struct {
	ctx context.Context
}

// NewApp creates a new App application struct
func NewApp() *App {
	return &App{}
}

// Startup is called when the app starts. The context is saved
// so we can call the runtime methods
func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx

	// Start editor HTTP server for standalone editor windows
	if err := a.StartEditorServer(); err != nil {
		log.Printf("⚠️ Failed to start editor server: %v", err)
	}
}

// GetSSHConfig is exposed to the frontend via Wails
func (a *App) GetSSHConfig() []SSHConfigEntry {
	return GetSSHConfig()
}

// CreateLocalTerminalSession creates a new local terminal session and returns the session ID
func (a *App) CreateLocalTerminalSession() (string, error) {
	sessionID := fmt.Sprintf("local-%d", time.Now().Unix())
	
	// The actual terminal session will be started when StartLocalTerminalSession is called
	// For now, we just return the session ID
	// The session will be created when the frontend calls StartLocalTerminalSession
	
	return sessionID, nil
}

// TerminalSettings represents terminal configuration settings
type TerminalSettings struct {
	EnableSelectToCopy      bool `json:"enableSelectToCopy"`
	EnableRightClickPaste   bool `json:"enableRightClickPaste"`
}

// getSettingsPath returns the path to the settings file
func getSettingsPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user config dir: %v", err)
	}
	
	appConfigDir := filepath.Join(configDir, "xterm-file-manager")
	if err := os.MkdirAll(appConfigDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create config directory: %v", err)
	}
	
	return filepath.Join(appConfigDir, "settings.json"), nil
}

// GetTerminalSettings returns the current terminal settings
func (a *App) GetTerminalSettings() (string, error) {
	settingsPath, err := getSettingsPath()
	if err != nil {
		return "", err
	}
	
	// Default settings
	defaultSettings := TerminalSettings{
		EnableSelectToCopy:    true,
		EnableRightClickPaste: true,
	}
	
	// Try to read existing settings
	data, err := os.ReadFile(settingsPath)
	if err != nil {
		// If file doesn't exist, return default settings
		if os.IsNotExist(err) {
			jsonData, _ := json.Marshal(defaultSettings)
			return string(jsonData), nil
		}
		return "", fmt.Errorf("failed to read settings: %v", err)
	}
	
	// Parse existing settings
	var settings TerminalSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		// If parsing fails, return default settings
		jsonData, _ := json.Marshal(defaultSettings)
		return string(jsonData), nil
	}
	
	// Return settings as JSON
	jsonData, err := json.Marshal(settings)
	if err != nil {
		return "", fmt.Errorf("failed to marshal settings: %v", err)
	}
	
	return string(jsonData), nil
}

// SetTerminalSettings saves the terminal settings
func (a *App) SetTerminalSettings(settingsJSON string) error {
	settingsPath, err := getSettingsPath()
	if err != nil {
		return err
	}
	
	// Parse settings
	var settings TerminalSettings
	if err := json.Unmarshal([]byte(settingsJSON), &settings); err != nil {
		return fmt.Errorf("failed to parse settings: %v", err)
	}
	
	// Write settings to file
	jsonData, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal settings: %v", err)
	}
	
	if err := os.WriteFile(settingsPath, jsonData, 0644); err != nil {
		return fmt.Errorf("failed to write settings: %v", err)
	}
	
	// Emit event to notify frontend of settings change
	if a.ctx != nil {
		runtime.EventsEmit(a.ctx, "terminal:settings-changed", settings)
	}
	
	return nil
}

// WriteDebugLog writes debug logs to a temporary file
func (a *App) WriteDebugLog(logContent string) error {
	logPath := "/tmp/xterm-file-manager-debug.log"
	
	// Open file in append mode, create if not exists
	f, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("failed to open log file: %v", err)
	}
	defer f.Close()
	
	// Write log content
	if _, err := f.WriteString(logContent); err != nil {
		return fmt.Errorf("failed to write log: %v", err)
	}
	
	return nil
}

// ClearDebugLog clears the debug log file
func (a *App) ClearDebugLog() error {
	logPath := "/tmp/xterm-file-manager-debug.log"
	
	// Remove the file if it exists
	if err := os.Remove(logPath); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("failed to clear log file: %v", err)
	}
	
	return nil
}

// ReadLocalFile reads a local file and returns its content
func (a *App) ReadLocalFile(filePath string) (string, error) {
	// Expand home directory if needed
	if len(filePath) >= 2 && filePath[:2] == "~/" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("failed to get home directory: %v", err)
		}
		filePath = filepath.Join(homeDir, filePath[2:])
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to read file: %v", err)
	}

	return string(data), nil
}

// WriteLocalFile writes content to a local file
func (a *App) WriteLocalFile(filePath string, content string) error {
	// Expand home directory if needed
	if len(filePath) >= 2 && filePath[:2] == "~/" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("failed to get home directory: %v", err)
		}
		filePath = filepath.Join(homeDir, filePath[2:])
	}

	if err := os.WriteFile(filePath, []byte(content), 0644); err != nil {
		return fmt.Errorf("failed to write file: %v", err)
	}

	return nil
}

// CreateLocalFile creates a new empty local file
func (a *App) CreateLocalFile(filePath string) error {
	// Expand home directory if needed
	if len(filePath) >= 2 && filePath[:2] == "~/" {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return fmt.Errorf("failed to get home directory: %v", err)
		}
		filePath = filepath.Join(homeDir, filePath[2:])
	}

	// Create parent directory if it doesn't exist
	dir := filepath.Dir(filePath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %v", err)
	}

	// Create empty file
	if err := os.WriteFile(filePath, []byte{}, 0644); err != nil {
		return fmt.Errorf("failed to create file: %v", err)
	}

	return nil
}

// GetDefaultEditorDirectory returns the default directory for editor files
func (a *App) GetDefaultEditorDirectory() (string, error) {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("failed to get home directory: %v", err)
	}

	// Use Documents/XTermFileManager as default
	documentsDir := filepath.Join(homeDir, "Documents", "XTermFileManager")
	
	// Create directory if it doesn't exist
	if err := os.MkdirAll(documentsDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create directory: %v", err)
	}

	return documentsDir, nil
}

// GetNextUntitledFileName returns the next available Untitled-N.txt filename
func (a *App) GetNextUntitledFileName(directory string) (string, error) {
	// Try Untitled.txt first
	basePath := filepath.Join(directory, "Untitled.txt")
	if _, err := os.Stat(basePath); os.IsNotExist(err) {
		return basePath, nil
	}

	// Try Untitled-1.txt, Untitled-2.txt, etc.
	for i := 1; i < 1000; i++ {
		fileName := fmt.Sprintf("Untitled-%d.txt", i)
		filePath := filepath.Join(directory, fileName)
		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			return filePath, nil
		}
	}

	return "", fmt.Errorf("too many untitled files")
}

// OpenFileDialog opens a file selection dialog and returns the selected file path
func (a *App) OpenFileDialog() (string, error) {
	filePath, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open File",
		Filters: []runtime.FileFilter{
			{DisplayName: "All Files (*.*)", Pattern: "*.*"},
			{DisplayName: "Text Files", Pattern: "*.txt;*.md;*.log"},
			{DisplayName: "Code Files", Pattern: "*.js;*.jsx;*.ts;*.tsx;*.go;*.py;*.java;*.c;*.cpp;*.rs"},
		},
	})
	
	if err != nil {
		return "", fmt.Errorf("failed to open file dialog: %v", err)
	}
	
	return filePath, nil
}

// ReadRemoteFile reads a remote file via SFTP and returns its content
func (a *App) ReadRemoteFile(sessionID string, remotePath string) (string, error) {
	sftpClient, err := getSFTPClient(sessionID)
	if err != nil {
		return "", err
	}
	defer sftpClient.Close()

	// Resolve ~ to home directory
	remotePath = resolveRemotePath(sftpClient, remotePath)

	// Open remote file
	file, err := sftpClient.Open(remotePath)
	if err != nil {
		return "", fmt.Errorf("failed to open remote file: %v", err)
	}
	defer file.Close()

	// Read file content
	var content []byte
	buffer := make([]byte, 32*1024)
	for {
		n, err := file.Read(buffer)
		if n > 0 {
			content = append(content, buffer[:n]...)
		}
		if err != nil {
			if err.Error() == "EOF" {
				break
			}
			return "", fmt.Errorf("failed to read file: %v", err)
		}
	}

	return string(content), nil
}

// WriteRemoteFile writes content to a remote file via SFTP
func (a *App) WriteRemoteFile(sessionID string, remotePath string, content string) error {
	sftpClient, err := getSFTPClient(sessionID)
	if err != nil {
		return err
	}
	defer sftpClient.Close()

	// Resolve ~ to home directory
	remotePath = resolveRemotePath(sftpClient, remotePath)

	// Create/open remote file
	file, err := sftpClient.Create(remotePath)
	if err != nil {
		return fmt.Errorf("failed to create remote file: %v", err)
	}
	defer file.Close()

	// Write content
	_, err = file.Write([]byte(content))
	if err != nil {
		return fmt.Errorf("failed to write to remote file: %v", err)
	}

	return nil
}
