package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// SaveFilesTabs saves files browser tabs to disk for persistence
func (a *App) SaveFilesTabs(tabsJSON string) error {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return fmt.Errorf("failed to get user config dir: %v", err)
	}

	appConfigDir := filepath.Join(configDir, "xterm-file-manager")
	if err := os.MkdirAll(appConfigDir, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %v", err)
	}

	tabsPath := filepath.Join(appConfigDir, "files-tabs.json")
	if err := os.WriteFile(tabsPath, []byte(tabsJSON), 0644); err != nil {
		return fmt.Errorf("failed to write files tabs file: %v", err)
	}

	return nil
}

// LoadFilesTabs loads files browser tabs from disk
func (a *App) LoadFilesTabs() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user config dir: %v", err)
	}

	tabsPath := filepath.Join(configDir, "xterm-file-manager", "files-tabs.json")

	// If file doesn't exist, return empty JSON
	if _, err := os.Stat(tabsPath); os.IsNotExist(err) {
		return "{}", nil
	}

	data, err := os.ReadFile(tabsPath)
	if err != nil {
		return "", fmt.Errorf("failed to read files tabs file: %v", err)
	}

	// Validate JSON before returning
	var testParse interface{}
	if err := json.Unmarshal(data, &testParse); err != nil {
		return "", fmt.Errorf("invalid JSON in files tabs file: %v", err)
	}

	return string(data), nil
}
