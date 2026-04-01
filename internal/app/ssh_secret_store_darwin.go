//go:build darwin

package app

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
)

const (
	sshPasswordKeychainService      = "xterm-file-manager:ssh-password"
	sshKeyPassphraseKeychainService = "xterm-file-manager:ssh-key-passphrase"
)

type keychainSecretRef struct {
	Service string `json:"service"`
	Account string `json:"account"`
}

type keychainSecretIndex struct {
	Entries []keychainSecretRef `json:"entries"`
}

var keychainIndexState = struct {
	data   keychainSecretIndex
	loaded bool
	mu     sync.RWMutex
}{}

func getKeychainIndexPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user config dir: %v", err)
	}

	appConfigDir := filepath.Join(configDir, "xterm-file-manager")
	if err := os.MkdirAll(appConfigDir, 0700); err != nil {
		return "", fmt.Errorf("failed to create config directory: %v", err)
	}

	return filepath.Join(appConfigDir, "ssh-keychain-index.json"), nil
}

func sshPasswordCacheKey(config SSHConfigEntry) string {
	hostname := config.Hostname
	if hostname == "" {
		hostname = config.Host
	}

	return fmt.Sprintf("%s|%s|%d|%s", config.Host, hostname, config.Port, config.User)
}

func loadKeychainIndex() error {
	keychainIndexState.mu.Lock()
	defer keychainIndexState.mu.Unlock()

	if keychainIndexState.loaded {
		return nil
	}

	path, err := getKeychainIndexPath()
	if err != nil {
		return err
	}

	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			keychainIndexState.data = keychainSecretIndex{Entries: []keychainSecretRef{}}
			keychainIndexState.loaded = true
			return nil
		}
		return fmt.Errorf("failed to read keychain index: %v", err)
	}

	var index keychainSecretIndex
	if err := json.Unmarshal(data, &index); err != nil {
		return fmt.Errorf("failed to parse keychain index: %v", err)
	}

	keychainIndexState.data = index
	keychainIndexState.loaded = true
	return nil
}

func persistKeychainIndexLocked() error {
	path, err := getKeychainIndexPath()
	if err != nil {
		return err
	}

	if len(keychainIndexState.data.Entries) == 0 {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("failed to remove empty keychain index: %v", err)
		}
		return nil
	}

	data, err := json.MarshalIndent(keychainIndexState.data, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal keychain index: %v", err)
	}

	if err := os.WriteFile(path, data, 0600); err != nil {
		return fmt.Errorf("failed to write keychain index: %v", err)
	}

	return nil
}

func addKeychainIndexEntry(service, account string) error {
	if err := loadKeychainIndex(); err != nil {
		return err
	}

	keychainIndexState.mu.Lock()
	defer keychainIndexState.mu.Unlock()

	for _, entry := range keychainIndexState.data.Entries {
		if entry.Service == service && entry.Account == account {
			return nil
		}
	}

	keychainIndexState.data.Entries = append(keychainIndexState.data.Entries, keychainSecretRef{
		Service: service,
		Account: account,
	})
	return persistKeychainIndexLocked()
}

func removeKeychainIndexEntry(service, account string) error {
	if err := loadKeychainIndex(); err != nil {
		return err
	}

	keychainIndexState.mu.Lock()
	defer keychainIndexState.mu.Unlock()

	filtered := keychainIndexState.data.Entries[:0]
	for _, entry := range keychainIndexState.data.Entries {
		if entry.Service == service && entry.Account == account {
			continue
		}
		filtered = append(filtered, entry)
	}
	keychainIndexState.data.Entries = filtered
	return persistKeychainIndexLocked()
}

func runSecurity(args ...string) ([]byte, error) {
	cmd := exec.Command("security", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("%v: %s", err, string(output))
	}
	return output, nil
}

func getSecretFromKeychain(service, account string) (string, bool, error) {
	output, err := runSecurity("find-generic-password", "-s", service, "-a", account, "-w")
	if err != nil {
		if isKeychainItemNotFound(err) {
			return "", false, nil
		}
		return "", false, err
	}
	return string(trimTrailingNewlines(output)), true, nil
}

func setSecretInKeychain(service, account, secret string) error {
	if _, err := runSecurity("add-generic-password", "-U", "-s", service, "-a", account, "-w", secret); err != nil {
		return err
	}
	return addKeychainIndexEntry(service, account)
}

func deleteSecretFromKeychain(service, account string) error {
	if _, err := runSecurity("delete-generic-password", "-s", service, "-a", account); err != nil && !isKeychainItemNotFound(err) {
		return err
	}
	return removeKeychainIndexEntry(service, account)
}

func isKeychainItemNotFound(err error) bool {
	if err == nil {
		return false
	}
	return containsAny(err.Error(), "could not be found", "The specified item could not be found in the keychain")
}

func trimTrailingNewlines(data []byte) []byte {
	for len(data) > 0 {
		last := data[len(data)-1]
		if last != '\n' && last != '\r' {
			break
		}
		data = data[:len(data)-1]
	}
	return data
}

func containsAny(input string, patterns ...string) bool {
	for _, pattern := range patterns {
		if pattern != "" && strings.Contains(input, pattern) {
			return true
		}
	}
	return false
}

func getCachedSSHPassword(config SSHConfigEntry) (string, bool, error) {
	return getSecretFromKeychain(sshPasswordKeychainService, sshPasswordCacheKey(config))
}

func cacheSSHPassword(config SSHConfigEntry, password string) error {
	if password == "" {
		return nil
	}
	return setSecretInKeychain(sshPasswordKeychainService, sshPasswordCacheKey(config), password)
}

func deleteCachedSSHPassword(config SSHConfigEntry) error {
	return deleteSecretFromKeychain(sshPasswordKeychainService, sshPasswordCacheKey(config))
}

func getCachedSSHKeyPassphrase(identityFile string) (string, bool, error) {
	return getSecretFromKeychain(sshKeyPassphraseKeychainService, identityFile)
}

func cacheSSHKeyPassphrase(identityFile string, passphrase string) error {
	if passphrase == "" {
		return nil
	}
	return setSecretInKeychain(sshKeyPassphraseKeychainService, identityFile, passphrase)
}

func deleteCachedSSHKeyPassphrase(identityFile string) error {
	return deleteSecretFromKeychain(sshKeyPassphraseKeychainService, identityFile)
}

func clearSSHPasswordCache() error {
	if err := loadKeychainIndex(); err != nil {
		return err
	}

	keychainIndexState.mu.RLock()
	entries := append([]keychainSecretRef(nil), keychainIndexState.data.Entries...)
	keychainIndexState.mu.RUnlock()

	for _, entry := range entries {
		if _, err := runSecurity("delete-generic-password", "-s", entry.Service, "-a", entry.Account); err != nil && !isKeychainItemNotFound(err) {
			return err
		}
	}

	keychainIndexState.mu.Lock()
	keychainIndexState.data = keychainSecretIndex{Entries: []keychainSecretRef{}}
	keychainIndexState.mu.Unlock()

	keychainIndexState.mu.Lock()
	defer keychainIndexState.mu.Unlock()
	return persistKeychainIndexLocked()
}
