package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type CommandSnippet struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Command     string   `json:"command"`
	Description string   `json:"description"`
	Tags        []string `json:"tags,omitempty"`
}

func getCommandSnippetsPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user config dir: %v", err)
	}

	appConfigDir := filepath.Join(configDir, "xterm-file-manager")
	if err := os.MkdirAll(appConfigDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create config directory: %v", err)
	}

	return filepath.Join(appConfigDir, "command-snippets.json"), nil
}

func defaultCommandSnippets() []CommandSnippet {
	return []CommandSnippet{
		{
			ID:          "tmux-new-session",
			Title:       "Create tmux session",
			Command:     "tmux new -s mysession",
			Description: "Start a new tmux session named mysession.",
			Tags:        []string{"tmux", "session"},
		},
		{
			ID:          "tmux-attach-session",
			Title:       "Attach tmux session",
			Command:     "tmux a -t mysession",
			Description: "Attach to an existing tmux session named mysession.",
			Tags:        []string{"tmux", "attach"},
		},
		{
			ID:          "tmux-kill-session",
			Title:       "Kill one tmux session",
			Command:     "tmux kill-session -t mysession",
			Description: "Terminate only the tmux session named mysession.",
			Tags:        []string{"tmux", "kill"},
		},
		{
			ID:          "tmux-kill-server",
			Title:       "Kill tmux server",
			Command:     "tmux kill-server",
			Description: "Stop the entire tmux server and all tmux sessions.",
			Tags:        []string{"tmux", "kill", "danger"},
		},
		{
			ID:          "journalctl-follow-service",
			Title:       "Follow service logs",
			Command:     "journalctl -u nginx -f --no-pager",
			Description: "Follow systemd service logs without paging.",
			Tags:        []string{"journalctl", "logs", "systemd"},
		},
		{
			ID:          "docker-follow-logs",
			Title:       "Follow Docker logs",
			Command:     "docker logs -f --tail=200 my-container",
			Description: "Watch the latest 200 log lines from a container.",
			Tags:        []string{"docker", "logs", "container"},
		},
		{
			ID:          "docker-shell",
			Title:       "Enter Docker shell",
			Command:     "docker exec -it my-container /bin/bash",
			Description: "Open an interactive shell inside a running container.",
			Tags:        []string{"docker", "shell", "exec"},
		},
		{
			ID:          "find-large-files",
			Title:       "Find largest files",
			Command:     "find . -type f -size +100M -print | sort",
			Description: "List files bigger than 100 MB under the current directory.",
			Tags:        []string{"find", "disk", "cleanup"},
		},
		{
			ID:          "list-listening-ports",
			Title:       "List listening ports",
			Command:     "lsof -iTCP -sTCP:LISTEN -nP",
			Description: "Show listening TCP ports with process names.",
			Tags:        []string{"network", "ports", "lsof"},
		},
		{
			ID:          "tar-create-backup",
			Title:       "Create tar.gz backup",
			Command:     "tar -czvf backup.tar.gz /path/to/dir",
			Description: "Archive and compress a directory into a tar.gz file.",
			Tags:        []string{"tar", "backup", "archive"},
		},
	}
}

func sanitizeCommandSnippets(snippets []CommandSnippet) []CommandSnippet {
	normalized := make([]CommandSnippet, 0, len(snippets))
	for index, snippet := range snippets {
		title := strings.TrimSpace(snippet.Title)
		command := strings.TrimSpace(snippet.Command)
		if command == "" {
			continue
		}
		if title == "" {
			title = command
		}

		tags := make([]string, 0, len(snippet.Tags))
		for _, tag := range snippet.Tags {
			trimmed := strings.TrimSpace(tag)
			if trimmed != "" {
				tags = append(tags, trimmed)
			}
		}

		id := strings.TrimSpace(snippet.ID)
		if id == "" {
			id = fmt.Sprintf("snippet-%d", index+1)
		}

		normalized = append(normalized, CommandSnippet{
			ID:          id,
			Title:       title,
			Command:     command,
			Description: strings.TrimSpace(snippet.Description),
			Tags:        tags,
		})
	}

	return normalized
}

func saveCommandSnippetsToPath(path string, snippets []CommandSnippet) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("failed to create config directory: %v", err)
	}

	data, err := json.MarshalIndent(snippets, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal command snippets: %v", err)
	}

	if err := os.WriteFile(path, append(data, '\n'), 0644); err != nil {
		return fmt.Errorf("failed to write command snippets file: %v", err)
	}

	return nil
}

func loadOrCreateCommandSnippets(path string) ([]CommandSnippet, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if !os.IsNotExist(err) {
			return nil, fmt.Errorf("failed to read command snippets file: %v", err)
		}
		data = nil
	}

	if strings.TrimSpace(string(data)) == "" {
		defaults := defaultCommandSnippets()
		if err := saveCommandSnippetsToPath(path, defaults); err != nil {
			return nil, err
		}
		return defaults, nil
	}

	var snippets []CommandSnippet
	if err := json.Unmarshal(data, &snippets); err != nil {
		return nil, fmt.Errorf("invalid JSON in command snippets file: %v", err)
	}

	snippets = sanitizeCommandSnippets(snippets)

	return snippets, nil
}

func isCommandSnippetsConfigPath(_ string, resolvedPath string) bool {
	configPath, err := getCommandSnippetsPath()
	if err != nil {
		return false
	}

	return filepath.Clean(resolvedPath) == filepath.Clean(configPath)
}

func (a *App) GetCommandSnippetsConfigPath() (string, error) {
	path, err := getCommandSnippetsPath()
	if err != nil {
		return "", err
	}

	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := saveCommandSnippetsToPath(path, defaultCommandSnippets()); err != nil {
			return "", err
		}
	} else if err != nil {
		return "", fmt.Errorf("failed to stat command snippets file: %v", err)
	}

	return path, nil
}

func (a *App) GetCommandSnippets() (string, error) {
	path, err := getCommandSnippetsPath()
	if err != nil {
		return "", err
	}

	snippets, err := loadOrCreateCommandSnippets(path)
	if err != nil {
		return "", err
	}

	data, err := json.Marshal(snippets)
	if err != nil {
		return "", fmt.Errorf("failed to marshal command snippets: %v", err)
	}

	return string(data), nil
}
