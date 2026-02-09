package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// SaveEditorTabs saves editor tabs to disk for persistence
func (a *App) SaveEditorTabs(tabsJSON string) error {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return fmt.Errorf("failed to get user config dir: %v", err)
	}

	appConfigDir := filepath.Join(configDir, "xterm-file-manager")
	if err := os.MkdirAll(appConfigDir, 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %v", err)
	}

	tabsPath := filepath.Join(appConfigDir, "editor-tabs.json")
	if err := os.WriteFile(tabsPath, []byte(tabsJSON), 0644); err != nil {
		return fmt.Errorf("failed to write editor tabs file: %v", err)
	}

	return nil
}

// LoadEditorTabs loads editor tabs from disk
func (a *App) LoadEditorTabs() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user config dir: %v", err)
	}

	tabsPath := filepath.Join(configDir, "xterm-file-manager", "editor-tabs.json")

	// If file doesn't exist, return empty JSON
	if _, err := os.Stat(tabsPath); os.IsNotExist(err) {
		return "{}", nil
	}

	data, err := os.ReadFile(tabsPath)
	if err != nil {
		return "", fmt.Errorf("failed to read editor tabs file: %v", err)
	}

	// Validate JSON before returning
	var testParse interface{}
	if err := json.Unmarshal(data, &testParse); err != nil {
		return "", fmt.Errorf("invalid JSON in editor tabs file: %v", err)
	}

	return string(data), nil
}
