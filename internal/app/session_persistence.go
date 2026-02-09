package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// SaveTerminalSessions saves terminal sessions to disk for persistence
func (a *App) SaveTerminalSessions(sessionsJSON string) error {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return fmt.Errorf("failed to get user config dir: %v", err)
	}

	appConfigDir := filepath.Join(configDir, "xterm-file-manager")
	if err := os.MkdirAll(appConfigDir, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %v", err)
	}

	sessionsPath := filepath.Join(appConfigDir, "sessions.json")
	if err := os.WriteFile(sessionsPath, []byte(sessionsJSON), 0644); err != nil {
		return fmt.Errorf("failed to write sessions file: %v", err)
	}

	return nil
}

// LoadTerminalSessions loads terminal sessions from disk
func (a *App) LoadTerminalSessions() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user config dir: %v", err)
	}

	sessionsPath := filepath.Join(configDir, "xterm-file-manager", "sessions.json")

	// If file doesn't exist, return empty JSON
	if _, err := os.Stat(sessionsPath); os.IsNotExist(err) {
		return "{}", nil
	}

	data, err := os.ReadFile(sessionsPath)
	if err != nil {
		return "", fmt.Errorf("failed to read sessions file: %v", err)
	}

	// Validate JSON before returning
	var testParse interface{}
	if err := json.Unmarshal(data, &testParse); err != nil {
		return "", fmt.Errorf("invalid JSON in sessions file: %v", err)
	}

	return string(data), nil
}
