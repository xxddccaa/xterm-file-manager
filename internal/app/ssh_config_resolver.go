package app

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	sshconfig "github.com/kevinburke/ssh_config"
)

type ResolvedSSHConfig struct {
	Alias               string
	Hostname            string
	User                string
	Port                int
	IdentityFiles       []string
	IdentityAgent       string
	ProxyJump           string
	ProxyCommand        string
	UserKnownHostsFiles []string
	ForwardAgent        bool
	IdentitiesOnly      bool
	UseKeychain         bool
	AddKeysToAgent      bool
	PasswordAuthEnabled bool
	ConnectTimeout      time.Duration
	ServerAliveInterval time.Duration
}

func getSSHConfigPath() (string, error) {
	usr, err := user.Current()
	if err != nil {
		return "", err
	}
	return filepath.Join(usr.HomeDir, ".ssh", "config"), nil
}

func getSystemSSHConfigPath() string {
	return filepath.Join("/", "etc", "ssh", "ssh_config")
}

func parseSSHConfigFile(path string) (*sshconfig.Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return sshconfig.DecodeBytes(data)
}

func getSSHConfigValue(userCfg, systemCfg *sshconfig.Config, alias, key string) (string, error) {
	if userCfg != nil {
		val, err := userCfg.Get(alias, key)
		if err != nil {
			return "", err
		}
		if val != "" {
			return val, nil
		}
	}

	if systemCfg != nil {
		val, err := systemCfg.Get(alias, key)
		if err != nil {
			return "", err
		}
		if val != "" {
			return val, nil
		}
	}

	return sshconfig.Default(key), nil
}

func getSSHConfigValues(userCfg, systemCfg *sshconfig.Config, alias, key string) ([]string, error) {
	if userCfg != nil {
		vals, err := userCfg.GetAll(alias, key)
		if err != nil {
			return nil, err
		}
		if vals != nil {
			return vals, nil
		}
	}

	if systemCfg != nil {
		vals, err := systemCfg.GetAll(alias, key)
		if err != nil {
			return nil, err
		}
		if vals != nil {
			return vals, nil
		}
	}

	if def := sshconfig.Default(key); def != "" {
		return []string{def}, nil
	}

	return []string{}, nil
}

func resolveSSHConfig(alias string) (*ResolvedSSHConfig, error) {
	userConfigPath, err := getSSHConfigPath()
	if err != nil {
		return nil, fmt.Errorf("failed to get SSH config path: %v", err)
	}

	var userCfg *sshconfig.Config
	if cfg, err := parseSSHConfigFile(userConfigPath); err == nil {
		userCfg = cfg
	} else if !os.IsNotExist(err) {
		return nil, fmt.Errorf("failed to parse SSH config: %v", err)
	}

	var systemCfg *sshconfig.Config
	if cfg, err := parseSSHConfigFile(getSystemSSHConfigPath()); err == nil {
		systemCfg = cfg
	} else if !os.IsNotExist(err) {
		log.Printf("⚠️ Failed to parse system SSH config: %v", err)
	}

	hostname, err := getSSHConfigValue(userCfg, systemCfg, alias, "HostName")
	if err != nil {
		return nil, err
	}
	if hostname == "" {
		hostname = alias
	}

	userValue, err := getSSHConfigValue(userCfg, systemCfg, alias, "User")
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(userValue) == "" {
		if currentUser, currentUserErr := user.Current(); currentUserErr == nil {
			userValue = currentUser.Username
		}
	}

	portValue, err := getSSHConfigValue(userCfg, systemCfg, alias, "Port")
	if err != nil {
		return nil, err
	}
	port := 22
	if portValue != "" {
		if parsedPort, err := strconv.Atoi(portValue); err == nil {
			port = parsedPort
		}
	}

	identityFiles, err := getSSHConfigValues(userCfg, systemCfg, alias, "IdentityFile")
	if err != nil {
		return nil, err
	}

	identityAgent, err := getSSHConfigValue(userCfg, systemCfg, alias, "IdentityAgent")
	if err != nil {
		return nil, err
	}

	proxyJump, err := getSSHConfigValue(userCfg, systemCfg, alias, "ProxyJump")
	if err != nil {
		return nil, err
	}

	proxyCommand, err := getSSHConfigValue(userCfg, systemCfg, alias, "ProxyCommand")
	if err != nil {
		return nil, err
	}

	userKnownHostsFiles, err := getSSHConfigValues(userCfg, systemCfg, alias, "UserKnownHostsFile")
	if err != nil {
		return nil, err
	}

	forwardAgent, err := getSSHConfigValue(userCfg, systemCfg, alias, "ForwardAgent")
	if err != nil {
		return nil, err
	}

	identitiesOnly, err := getSSHConfigValue(userCfg, systemCfg, alias, "IdentitiesOnly")
	if err != nil {
		return nil, err
	}

	useKeychain, err := getSSHConfigValue(userCfg, systemCfg, alias, "UseKeychain")
	if err != nil {
		return nil, err
	}

	addKeysToAgent, err := getSSHConfigValue(userCfg, systemCfg, alias, "AddKeysToAgent")
	if err != nil {
		return nil, err
	}

	passwordAuthentication, err := getSSHConfigValue(userCfg, systemCfg, alias, "PasswordAuthentication")
	if err != nil {
		return nil, err
	}

	connectTimeout, err := getSSHConfigValue(userCfg, systemCfg, alias, "ConnectTimeout")
	if err != nil {
		return nil, err
	}

	serverAliveInterval, err := getSSHConfigValue(userCfg, systemCfg, alias, "ServerAliveInterval")
	if err != nil {
		return nil, err
	}

	resolved := &ResolvedSSHConfig{
		Alias:               alias,
		Hostname:            hostname,
		User:                userValue,
		Port:                port,
		IdentityFiles:       normalizeIdentityFiles(identityFiles),
		IdentityAgent:       identityAgent,
		ProxyJump:           proxyJump,
		ProxyCommand:        proxyCommand,
		UserKnownHostsFiles: normalizeKnownHostsFiles(userKnownHostsFiles),
		ForwardAgent:        parseSSHDirectiveEnabled(forwardAgent, false),
		IdentitiesOnly:      parseSSHBool(identitiesOnly, false),
		UseKeychain:         parseSSHDirectiveEnabled(useKeychain, false),
		AddKeysToAgent:      parseSSHDirectiveEnabled(addKeysToAgent, false),
		PasswordAuthEnabled: !strings.EqualFold(passwordAuthentication, "no"),
		ConnectTimeout:      parseSSHDurationSeconds(connectTimeout, SSHConnectTimeout*time.Second),
		ServerAliveInterval: parseSSHDurationSeconds(serverAliveInterval, 0),
	}

	if len(resolved.UserKnownHostsFiles) == 0 {
		if homeDir, err := os.UserHomeDir(); err == nil {
			resolved.UserKnownHostsFiles = []string{filepath.Join(homeDir, ".ssh", "known_hosts")}
		}
	}

	return resolved, nil
}

func normalizeIdentityFiles(values []string) []string {
	files := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || strings.EqualFold(value, "none") {
			continue
		}
		files = append(files, value)
	}
	return uniqueStrings(files)
}

func normalizeKnownHostsFiles(values []string) []string {
	paths := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || strings.EqualFold(value, "none") {
			continue
		}
		paths = append(paths, value)
	}
	return uniqueStrings(paths)
}

func parseSSHBool(value string, defaultValue bool) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "yes", "true", "on":
		return true
	case "no", "false", "off":
		return false
	default:
		return defaultValue
	}
}

func parseSSHDirectiveEnabled(value string, defaultValue bool) bool {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		return defaultValue
	}

	switch value {
	case "yes", "true", "on", "ask", "confirm":
		return true
	case "no", "false", "off", "none":
		return false
	default:
		return true
	}
}

func parseSSHDurationSeconds(value string, defaultValue time.Duration) time.Duration {
	value = strings.TrimSpace(value)
	if value == "" {
		return defaultValue
	}

	seconds, err := strconv.Atoi(value)
	if err != nil {
		return defaultValue
	}
	return time.Duration(seconds) * time.Second
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

// GetSSHConfig parses ~/.ssh/config and returns list of hosts.
func GetSSHConfig() []SSHConfigEntry {
	aliases := make([]string, 0)

	if configPath, err := getSSHConfigPath(); err == nil {
		userAliases, collectErr := collectSSHConfigAliases(configPath, false, 0, map[string]struct{}{})
		if collectErr != nil {
			log.Printf("⚠️ Failed to collect user SSH config aliases: %v", collectErr)
		} else {
			aliases = append(aliases, userAliases...)
		}
	}

	systemAliases, err := collectSSHConfigAliases(getSystemSSHConfigPath(), true, 0, map[string]struct{}{})
	if err != nil {
		log.Printf("⚠️ Failed to collect system SSH config aliases: %v", err)
	} else {
		aliases = append(aliases, systemAliases...)
	}

	aliases = uniqueStrings(aliases)

	entries := make([]SSHConfigEntry, 0, len(aliases))
	for idx, alias := range aliases {
		resolved, err := resolveSSHConfig(alias)
		if err != nil {
			log.Printf("⚠️ Failed to resolve SSH config for %s: %v", alias, err)
			continue
		}

		entry := SSHConfigEntry{
			ID:       fmt.Sprintf("ssh-%d", idx),
			Host:     alias,
			Hostname: resolved.Hostname,
			User:     resolved.User,
			Port:     resolved.Port,
		}
		if len(resolved.IdentityFiles) > 0 {
			entry.IdentityFile = resolved.IdentityFiles[0]
		}
		entries = append(entries, entry)
	}

	return entries
}

func collectSSHConfigAliases(path string, system bool, depth uint8, seen map[string]struct{}) ([]string, error) {
	if depth > 5 {
		return nil, fmt.Errorf("max SSH include depth exceeded")
	}

	cleanPath := filepath.Clean(path)
	if _, ok := seen[cleanPath]; ok {
		return nil, nil
	}
	seen[cleanPath] = struct{}{}

	file, err := os.Open(cleanPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer file.Close()

	var aliases []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		line = stripInlineSSHComment(line)
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}

		key := strings.ToLower(fields[0])
		value := strings.TrimSpace(line[len(fields[0]):])
		value = strings.TrimLeft(value, " \t=")
		switch key {
		case "host":
			for _, pattern := range strings.Fields(value) {
				if shouldListSSHAlias(pattern) {
					aliases = append(aliases, pattern)
				}
			}
		case "include":
			for _, includePath := range strings.Fields(value) {
				matches, err := expandSSHIncludePaths(includePath, system)
				if err != nil {
					return nil, err
				}
				for _, match := range matches {
					childAliases, err := collectSSHConfigAliases(match, strings.HasPrefix(filepath.Clean(match), "/etc/ssh"), depth+1, seen)
					if err != nil {
						return nil, err
					}
					aliases = append(aliases, childAliases...)
				}
			}
		}
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return uniqueStrings(aliases), nil
}

func stripInlineSSHComment(line string) string {
	inQuotes := false
	for idx, ch := range line {
		switch ch {
		case '"':
			inQuotes = !inQuotes
		case '#':
			if !inQuotes {
				return strings.TrimSpace(line[:idx])
			}
		}
	}
	return strings.TrimSpace(line)
}

func expandSSHIncludePaths(value string, system bool) ([]string, error) {
	var base string
	switch {
	case filepath.IsAbs(value):
		base = value
	case strings.HasPrefix(value, "~/"):
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		base = filepath.Join(homeDir, value[2:])
	case system:
		base = filepath.Join("/etc/ssh", value)
	default:
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return nil, err
		}
		base = filepath.Join(homeDir, ".ssh", value)
	}

	matches, err := filepath.Glob(base)
	if err != nil {
		return nil, err
	}
	if matches == nil {
		return []string{}, nil
	}
	return matches, nil
}

func shouldListSSHAlias(pattern string) bool {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" || pattern == "*" || strings.HasPrefix(pattern, "!") {
		return false
	}
	return !strings.ContainsAny(pattern, "*?")
}
