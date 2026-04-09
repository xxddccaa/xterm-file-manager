package app

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestCollectSSHConfigAliasesPreservesFileOrder(t *testing.T) {
	tempDir := t.TempDir()
	configPath := filepath.Join(tempDir, "config")

	config := []byte(`Host beta
  HostName beta.example.com

Host alpha
  HostName alpha.example.com

Host beta
  HostName beta-duplicate.example.com
`)

	if err := os.WriteFile(configPath, config, 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	aliases, err := collectSSHConfigAliases(configPath, false, 0, map[string]struct{}{})
	if err != nil {
		t.Fatalf("collect aliases: %v", err)
	}

	if !reflect.DeepEqual(aliases, []string{"beta", "alpha"}) {
		t.Fatalf("unexpected aliases: %#v", aliases)
	}
}

func TestCollectSSHConfigAliasesKeepsIncludedHostsInline(t *testing.T) {
	tempDir := t.TempDir()
	includePath := filepath.Join(tempDir, "included.conf")
	configPath := filepath.Join(tempDir, "config")

	if err := os.WriteFile(includePath, []byte(`Host gamma
  HostName gamma.example.com
`), 0600); err != nil {
		t.Fatalf("write include: %v", err)
	}

	config := []byte("Host alpha\n  HostName alpha.example.com\n\nInclude " + includePath + "\n\nHost omega\n  HostName omega.example.com\n")
	if err := os.WriteFile(configPath, config, 0600); err != nil {
		t.Fatalf("write config: %v", err)
	}

	aliases, err := collectSSHConfigAliases(configPath, false, 0, map[string]struct{}{})
	if err != nil {
		t.Fatalf("collect aliases: %v", err)
	}

	if !reflect.DeepEqual(aliases, []string{"alpha", "gamma", "omega"}) {
		t.Fatalf("unexpected aliases: %#v", aliases)
	}
}
