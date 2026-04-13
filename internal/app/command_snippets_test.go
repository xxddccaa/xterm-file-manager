package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadOrCreateCommandSnippetsSeedsDefaultsForEmptyFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "command-snippets.json")
	if err := os.WriteFile(path, []byte("  \n"), 0644); err != nil {
		t.Fatalf("write empty config: %v", err)
	}

	snippets, err := loadOrCreateCommandSnippets(path)
	if err != nil {
		t.Fatalf("load command snippets: %v", err)
	}

	if len(snippets) == 0 {
		t.Fatalf("expected default command snippets to be seeded")
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read seeded config: %v", err)
	}

	if !strings.Contains(string(data), "tmux kill-server") {
		t.Fatalf("expected seeded config to contain default tmux commands, got: %s", string(data))
	}
}

func TestSanitizeCommandSnippetsDropsBlankCommandsAndFillsTitle(t *testing.T) {
	snippets := sanitizeCommandSnippets([]CommandSnippet{
		{ID: "", Title: "", Command: "  tmux ls  ", Description: "  list sessions  ", Tags: []string{" tmux ", " "}},
		{ID: "skip-me", Title: "Broken", Command: "   "},
	})

	if len(snippets) != 1 {
		t.Fatalf("expected one valid snippet, got %d", len(snippets))
	}

	if snippets[0].Title != "tmux ls" {
		t.Fatalf("expected empty title to fall back to command, got %q", snippets[0].Title)
	}

	if snippets[0].ID == "" {
		t.Fatalf("expected snippet ID to be generated")
	}

	if len(snippets[0].Tags) != 1 || snippets[0].Tags[0] != "tmux" {
		t.Fatalf("expected trimmed tags, got %#v", snippets[0].Tags)
	}
}

func TestLoadOrCreateCommandSnippetsKeepsExplicitEmptyArray(t *testing.T) {
	path := filepath.Join(t.TempDir(), "command-snippets.json")
	if err := os.WriteFile(path, []byte("[]\n"), 0644); err != nil {
		t.Fatalf("write empty array config: %v", err)
	}

	snippets, err := loadOrCreateCommandSnippets(path)
	if err != nil {
		t.Fatalf("load command snippets: %v", err)
	}

	if len(snippets) != 0 {
		t.Fatalf("expected explicit empty array to stay empty, got %d snippets", len(snippets))
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read config: %v", err)
	}

	if strings.TrimSpace(string(data)) != "[]" {
		t.Fatalf("expected config file to remain empty array, got: %s", string(data))
	}
}
