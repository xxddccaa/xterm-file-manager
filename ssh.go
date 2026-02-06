package main

import (
	"bufio"
	"fmt"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
)

type SSHConfigEntry struct {
	ID           string `json:"id"`
	Host         string `json:"host"`
	Hostname     string `json:"hostname"`
	User         string `json:"user"`
	Port         int    `json:"port"`
	IdentityFile string `json:"identityFile"`
}

// GetSSHConfig parses ~/.ssh/config and returns list of hosts
// This is a standalone function that can be called from App
func GetSSHConfig() []SSHConfigEntry {
	usr, err := user.Current()
	if err != nil {
		return []SSHConfigEntry{}
	}

	configPath := filepath.Join(usr.HomeDir, ".ssh", "config")
	file, err := os.Open(configPath)
	if err != nil {
		return []SSHConfigEntry{}
	}
	defer file.Close()

	var entries []SSHConfigEntry
	var currentHost *SSHConfigEntry
	scanner := bufio.NewScanner(file)

	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}

		parts := strings.Fields(line)
		if len(parts) < 2 {
			continue
		}

		key := strings.ToLower(parts[0])
		value := strings.Join(parts[1:], " ")

		switch key {
		case "host":
			if currentHost != nil && currentHost.Host != "" {
				entries = append(entries, *currentHost)
			}
			currentHost = &SSHConfigEntry{
				ID:   fmt.Sprintf("ssh-%d", len(entries)),
				Host: value,
				Port: 22, // default port
			}
		case "hostname":
			if currentHost != nil {
				currentHost.Hostname = value
			}
		case "user":
			if currentHost != nil {
				currentHost.User = value
			}
		case "port":
			if currentHost != nil {
				if port, err := strconv.Atoi(value); err == nil {
					currentHost.Port = port
				}
			}
		case "identityfile":
			if currentHost != nil {
				currentHost.IdentityFile = strings.Trim(value, "\"")
			}
		}
	}

	if currentHost != nil && currentHost.Host != "" {
		entries = append(entries, *currentHost)
	}

	return entries
}
