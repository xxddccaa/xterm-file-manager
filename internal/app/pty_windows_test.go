//go:build windows

package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

type fakeWindowsTerminalWaiter struct {
	wait func(ctx context.Context) (uint32, error)
}

func (f fakeWindowsTerminalWaiter) Wait(ctx context.Context) (uint32, error) {
	return f.wait(ctx)
}

func TestPrepareWindowsTerminalLaunchConfig(t *testing.T) {
	tempDir := t.TempDir()

	config := prepareWindowsTerminalLaunchConfig(
		tempDir,
		30,
		120,
		[]string{"PATH=C:\\Windows\\System32"},
		`C:\Windows\System32\cmd.exe`,
		func(name string) (string, error) {
			t.Fatalf("lookPath should not be called when COMSPEC is set, got %s", name)
			return "", nil
		},
	)

	if config.Shell != `C:\Windows\System32\cmd.exe` {
		t.Fatalf("expected COMSPEC shell, got %q", config.Shell)
	}
	if config.WorkDir != tempDir {
		t.Fatalf("expected work dir %q, got %q", tempDir, config.WorkDir)
	}
	if config.Rows != 30 || config.Cols != 120 {
		t.Fatalf("expected 30x120 launch size, got %dx%d", config.Rows, config.Cols)
	}
	if len(config.Env) != 2 {
		t.Fatalf("expected copied env plus TERM, got %v", config.Env)
	}
	if config.Env[0] != "PATH=C:\\Windows\\System32" {
		t.Fatalf("expected original env preserved, got %v", config.Env)
	}
	if config.Env[1] != "TERM=xterm-256color" {
		t.Fatalf("expected TERM to be added, got %v", config.Env)
	}
}

func TestResolveWindowsTerminalShellFallbackOrder(t *testing.T) {
	shell := resolveWindowsTerminalShell("", func(name string) (string, error) {
		if name == "pwsh.exe" {
			return "", fmt.Errorf("missing")
		}
		if name == "powershell.exe" {
			return `C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`, nil
		}
		return "", fmt.Errorf("unexpected fallback %s", name)
	})

	if shell != "powershell.exe" {
		t.Fatalf("expected powershell.exe fallback, got %q", shell)
	}
}

func TestResolveWindowsTerminalWorkDir(t *testing.T) {
	tempDir := t.TempDir()
	filePath := filepath.Join(tempDir, "not-a-dir.txt")
	if err := os.WriteFile(filePath, []byte("test"), 0o644); err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}

	if got := resolveWindowsTerminalWorkDir(tempDir); got != tempDir {
		t.Fatalf("expected valid dir %q, got %q", tempDir, got)
	}
	if got := resolveWindowsTerminalWorkDir(filePath); got != "" {
		t.Fatalf("expected file path to be rejected, got %q", got)
	}
	if got := resolveWindowsTerminalWorkDir(filepath.Join(tempDir, "missing")); got != "" {
		t.Fatalf("expected missing path to be rejected, got %q", got)
	}
}

func TestBuildWindowsCommandLine(t *testing.T) {
	tests := []struct {
		name     string
		command  string
		expected string
	}{
		{
			name:     "quotes path with spaces",
			command:  `C:\Program Files\PowerShell\7\pwsh.exe`,
			expected: `"C:\Program Files\PowerShell\7\pwsh.exe"`,
		},
		{
			name:     "keeps simple executable",
			command:  "cmd.exe",
			expected: "cmd.exe",
		},
		{
			name:     "keeps pre-quoted command",
			command:  `"C:\Program Files\PowerShell\7\pwsh.exe"`,
			expected: `"C:\Program Files\PowerShell\7\pwsh.exe"`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := buildWindowsCommandLine(tt.command); got != tt.expected {
				t.Fatalf("expected %q, got %q", tt.expected, got)
			}
		})
	}
}

func TestMonitorWindowsTerminalSessionMarksDisconnectedOnExit(t *testing.T) {
	a := &App{}
	termSession := &TerminalSession{
		SessionID:   "session-exit",
		stopChan:    make(chan struct{}),
		isConnected: true,
	}

	a.monitorWindowsTerminalSession("session-exit", termSession, context.Background(), fakeWindowsTerminalWaiter{
		wait: func(ctx context.Context) (uint32, error) {
			return 0, nil
		},
	})

	if termSession.isConnected {
		t.Fatalf("expected session to be marked disconnected")
	}

	select {
	case <-termSession.stopChan:
	default:
		t.Fatalf("expected stop channel to be closed")
	}
}

func TestMonitorWindowsTerminalSessionSkipsDisconnectOnCancel(t *testing.T) {
	a := &App{}
	termSession := &TerminalSession{
		SessionID:   "session-cancel",
		stopChan:    make(chan struct{}),
		isConnected: true,
	}
	waitCtx, cancel := context.WithCancel(context.Background())
	cancel()

	a.monitorWindowsTerminalSession("session-cancel", termSession, waitCtx, fakeWindowsTerminalWaiter{
		wait: func(ctx context.Context) (uint32, error) {
			return 259, fmt.Errorf("wait canceled: %v", ctx.Err())
		},
	})

	if !termSession.isConnected {
		t.Fatalf("expected canceled wait to leave session state unchanged")
	}

	select {
	case <-termSession.stopChan:
		t.Fatalf("expected stop channel to remain open on canceled wait")
	default:
	}
}
