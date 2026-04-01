//go:build !darwin

package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

type sshSecretStore struct {
	Passwords      map[string]string `json:"passwords"`
	KeyPassphrases map[string]string `json:"keyPassphrases"`
}

var fallbackSSHSecrets = struct {
	data   sshSecretStore
	loaded bool
	mu     sync.RWMutex
}{
	data: sshSecretStore{
		Passwords:      make(map[string]string),
		KeyPassphrases: make(map[string]string),
	},
}

func getSSHSecretStorePath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user config dir: %v", err)
	}

	appConfigDir := filepath.Join(configDir, "xterm-file-manager")
	if err := os.MkdirAll(appConfigDir, 0700); err != nil {
		return "", fmt.Errorf("failed to create config directory: %v", err)
	}

	return filepath.Join(appConfigDir, "ssh-secret-cache.json"), nil
}

func sshPasswordCacheKey(config SSHConfigEntry) string {
	hostname := config.Hostname
	if hostname == "" {
		hostname = config.Host
	}

	return fmt.Sprintf("%s|%s|%d|%s", config.Host, hostname, config.Port, config.User)
}

func loadFallbackSSHSecrets() error {
	fallbackSSHSecrets.mu.Lock()
	defer fallbackSSHSecrets.mu.Unlock()

	if fallbackSSHSecrets.loaded {
		return nil
	}

	cachePath, err := getSSHSecretStorePath()
	if err != nil {
		return err
	}

	data, err := os.ReadFile(cachePath)
	if err != nil {
		if os.IsNotExist(err) {
			fallbackSSHSecrets.data = sshSecretStore{
				Passwords:      make(map[string]string),
				KeyPassphrases: make(map[string]string),
			}
			fallbackSSHSecrets.loaded = true
			return nil
		}
		return fmt.Errorf("failed to read SSH secret store: %v", err)
	}

	var store sshSecretStore
	if err := json.Unmarshal(data, &store); err != nil {
		return fmt.Errorf("failed to parse SSH secret store: %v", err)
	}

	if store.Passwords == nil {
		store.Passwords = make(map[string]string)
	}
	if store.KeyPassphrases == nil {
		store.KeyPassphrases = make(map[string]string)
	}

	fallbackSSHSecrets.data = store
	fallbackSSHSecrets.loaded = true
	return nil
}

func persistFallbackSSHSecretsLocked() error {
	cachePath, err := getSSHSecretStorePath()
	if err != nil {
		return err
	}

	if len(fallbackSSHSecrets.data.Passwords) == 0 && len(fallbackSSHSecrets.data.KeyPassphrases) == 0 {
		if err := os.Remove(cachePath); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("failed to remove empty SSH secret store: %v", err)
		}
		return nil
	}

	data, err := json.MarshalIndent(fallbackSSHSecrets.data, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal SSH secret store: %v", err)
	}

	if err := os.WriteFile(cachePath, data, 0600); err != nil {
		return fmt.Errorf("failed to write SSH secret store: %v", err)
	}

	return nil
}

func getCachedSSHPassword(config SSHConfigEntry) (string, bool, error) {
	if err := loadFallbackSSHSecrets(); err != nil {
		return "", false, err
	}

	key := sshPasswordCacheKey(config)

	fallbackSSHSecrets.mu.RLock()
	defer fallbackSSHSecrets.mu.RUnlock()

	password, ok := fallbackSSHSecrets.data.Passwords[key]
	return password, ok, nil
}

func cacheSSHPassword(config SSHConfigEntry, password string) error {
	if password == "" {
		return nil
	}
	if err := loadFallbackSSHSecrets(); err != nil {
		return err
	}

	key := sshPasswordCacheKey(config)

	fallbackSSHSecrets.mu.Lock()
	defer fallbackSSHSecrets.mu.Unlock()

	fallbackSSHSecrets.data.Passwords[key] = password
	return persistFallbackSSHSecretsLocked()
}

func deleteCachedSSHPassword(config SSHConfigEntry) error {
	if err := loadFallbackSSHSecrets(); err != nil {
		return err
	}

	key := sshPasswordCacheKey(config)

	fallbackSSHSecrets.mu.Lock()
	defer fallbackSSHSecrets.mu.Unlock()

	delete(fallbackSSHSecrets.data.Passwords, key)
	return persistFallbackSSHSecretsLocked()
}

func getCachedSSHKeyPassphrase(identityFile string) (string, bool, error) {
	if err := loadFallbackSSHSecrets(); err != nil {
		return "", false, err
	}

	fallbackSSHSecrets.mu.RLock()
	defer fallbackSSHSecrets.mu.RUnlock()

	value, ok := fallbackSSHSecrets.data.KeyPassphrases[identityFile]
	return value, ok, nil
}

func cacheSSHKeyPassphrase(identityFile string, passphrase string) error {
	if passphrase == "" {
		return nil
	}
	if err := loadFallbackSSHSecrets(); err != nil {
		return err
	}

	fallbackSSHSecrets.mu.Lock()
	defer fallbackSSHSecrets.mu.Unlock()

	fallbackSSHSecrets.data.KeyPassphrases[identityFile] = passphrase
	return persistFallbackSSHSecretsLocked()
}

func deleteCachedSSHKeyPassphrase(identityFile string) error {
	if err := loadFallbackSSHSecrets(); err != nil {
		return err
	}

	fallbackSSHSecrets.mu.Lock()
	defer fallbackSSHSecrets.mu.Unlock()

	delete(fallbackSSHSecrets.data.KeyPassphrases, identityFile)
	return persistFallbackSSHSecretsLocked()
}

func clearSSHPasswordCache() error {
	if err := loadFallbackSSHSecrets(); err != nil {
		return err
	}

	fallbackSSHSecrets.mu.Lock()
	defer fallbackSSHSecrets.mu.Unlock()

	fallbackSSHSecrets.data = sshSecretStore{
		Passwords:      make(map[string]string),
		KeyPassphrases: make(map[string]string),
	}
	return persistFallbackSSHSecretsLocked()
}
