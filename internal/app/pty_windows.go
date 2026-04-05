//go:build windows

package app

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"

	"github.com/UserExistsError/conpty"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// TerminalSessionWindows extends TerminalSession with Windows-specific fields
type TerminalSessionWindows struct {
	*TerminalSession
	ConPTY     *conpty.ConPty // Windows ConPTY handle
	waitCancel context.CancelFunc
}

var (
	windowsSessions   = make(map[string]*TerminalSessionWindows)
	windowsSessionsMu sync.RWMutex
)

type windowsTerminalWaiter interface {
	Wait(ctx context.Context) (uint32, error)
}

type windowsTerminalLaunchConfig struct {
	Shell   string
	WorkDir string
	Env     []string
	Rows    int
	Cols    int
}

func prepareWindowsTerminalLaunchConfig(
	initialDir string,
	rows int,
	cols int,
	environ []string,
	comspec string,
	lookPath func(string) (string, error),
) windowsTerminalLaunchConfig {
	return windowsTerminalLaunchConfig{
		Shell:   resolveWindowsTerminalShell(comspec, lookPath),
		WorkDir: resolveWindowsTerminalWorkDir(initialDir),
		Env:     buildWindowsTerminalEnv(environ),
		Rows:    rows,
		Cols:    cols,
	}
}

func resolveWindowsTerminalShell(comspec string, lookPath func(string) (string, error)) string {
	if strings.TrimSpace(comspec) != "" {
		return strings.TrimSpace(comspec)
	}

	for _, candidate := range []string{"pwsh.exe", "powershell.exe", "cmd.exe"} {
		if _, err := lookPath(candidate); err == nil {
			return candidate
		}
	}

	return "cmd.exe"
}

func resolveWindowsTerminalWorkDir(initialDir string) string {
	if strings.TrimSpace(initialDir) == "" {
		return ""
	}

	if stat, err := os.Stat(initialDir); err == nil && stat.IsDir() {
		return initialDir
	}

	log.Printf("⚠️ Invalid initial directory %s, using default", initialDir)
	return ""
}

func buildWindowsTerminalEnv(environ []string) []string {
	cleanEnv := make([]string, 0, len(environ)+1)
	termSet := false
	for _, env := range environ {
		if strings.HasPrefix(strings.ToUpper(env), "TERM=") {
			termSet = true
		}
		cleanEnv = append(cleanEnv, env)
	}

	if !termSet {
		cleanEnv = append(cleanEnv, "TERM=xterm-256color")
	}

	return cleanEnv
}

func buildWindowsCommandLine(command string) string {
	trimmed := strings.TrimSpace(command)
	if trimmed == "" {
		return "cmd.exe"
	}

	if strings.HasPrefix(trimmed, "\"") {
		return trimmed
	}

	if strings.ContainsAny(trimmed, " \t") {
		return `"` + trimmed + `"`
	}

	return trimmed
}

func (a *App) monitorWindowsTerminalSession(
	sessionID string,
	termSession *TerminalSession,
	waitCtx context.Context,
	waiter windowsTerminalWaiter,
) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("❌ PANIC RECOVERED in local terminal monitor goroutine for session %s: %v", sessionID, r)
		}
	}()

	exitCode, err := waiter.Wait(waitCtx)
	if waitCtx.Err() != nil {
		log.Printf("ℹ️ Windows terminal session monitor canceled: %s", sessionID)
		return
	}

	reason := "Process exited"
	if err != nil {
		reason = fmt.Sprintf("Process wait failed: %v", err)
		log.Printf("⚠️ Windows terminal wait failed for %s: %v", sessionID, err)
	} else if exitCode != 0 {
		reason = fmt.Sprintf("Process exited with code %d", exitCode)
	}

	termSession.mu.Lock()
	termSession.isConnected = false
	termSession.mu.Unlock()
	termSession.stopOnce.Do(func() { close(termSession.stopChan) })

	if a.ctx != nil {
		wailsRuntime.EventsEmit(a.ctx, "terminal:disconnected", map[string]interface{}{
			"sessionId": sessionID,
			"reason":    reason,
		})
	}

	log.Printf("Local terminal session ended: %s (%s)", sessionID, reason)
}

// StartLocalTerminalSession starts a local PTY session using Windows ConPTY
func (a *App) StartLocalTerminalSession(sessionID string, rows int, cols int, initialDir string) error {
	// Guard: atomic check-and-mark with WRITE lock to prevent TOCTOU race condition
	termSessionMu.Lock()
	if _, exists := terminalSessions[sessionID]; exists {
		termSessionMu.Unlock()
		log.Printf("⚠️ StartLocalTerminalSession: terminal session already exists for %s, skipping duplicate", sessionID)
		return nil
	}
	// Reserve slot immediately under write lock to block concurrent calls
	terminalSessions[sessionID] = &TerminalSession{SessionID: sessionID, stopChan: make(chan struct{}), isLocal: true}
	termSessionMu.Unlock()

	// Clean up reserved slot if session creation fails
	sessionReady := false
	defer func() {
		if !sessionReady {
			termSessionMu.Lock()
			delete(terminalSessions, sessionID)
			termSessionMu.Unlock()
		}
	}()

	launchConfig := prepareWindowsTerminalLaunchConfig(
		initialDir,
		rows,
		cols,
		os.Environ(),
		os.Getenv("COMSPEC"),
		exec.LookPath,
	)

	options := []conpty.ConPtyOption{
		conpty.ConPtyDimensions(launchConfig.Cols, launchConfig.Rows),
		conpty.ConPtyEnv(launchConfig.Env),
	}
	if launchConfig.WorkDir != "" {
		options = append(options, conpty.ConPtyWorkDir(launchConfig.WorkDir))
	}

	// Create ConPTY with the resolved working directory and environment.
	cpty, err := conpty.Start(buildWindowsCommandLine(launchConfig.Shell), options...)
	if err != nil {
		return fmt.Errorf("failed to create ConPTY: %v", err)
	}

	log.Printf("✅ Started Windows terminal with shell: %s, size: %dx%d", launchConfig.Shell, cols, rows)

	// Create terminal session with UTF-8 safe buffer
	termSession := &TerminalSession{
		SessionID:   sessionID,
		LocalCmd:    nil,
		LocalPTY:    nil, // Not used on Windows
		LocalStdin:  cpty,
		stopChan:    make(chan struct{}),
		isConnected: true,
		isLocal:     true,
		utf8Buffer:  &UTF8SafeBuffer{}, // Prevent UTF-8 truncation in Windows terminal output
	}

	waitCtx, waitCancel := context.WithCancel(context.Background())

	// Store Windows-specific session
	winSession := &TerminalSessionWindows{
		TerminalSession: termSession,
		ConPTY:          cpty,
		waitCancel:      waitCancel,
	}

	windowsSessionsMu.Lock()
	windowsSessions[sessionID] = winSession
	windowsSessionsMu.Unlock()

	// Store in main sessions map (overwrite placeholder)
	termSessionMu.Lock()
	terminalSessions[sessionID] = termSession
	termSessionMu.Unlock()
	sessionReady = true

	// Start output reader
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("❌ PANIC RECOVERED in local terminal reader goroutine for session %s: %v", sessionID, r)
			}
			termSessionMu.Lock()
			if ts, ok := terminalSessions[sessionID]; ok {
				ts.isConnected = false
			}
			termSessionMu.Unlock()

			// Flush any remaining bytes when session ends
			if remaining := termSession.utf8Buffer.Flush(); remaining != "" {
				a.emitTerminalOutput(sessionID, remaining)
			}
		}()

		buffer := make([]byte, IOBufferSize)
		for {
			select {
			case <-termSession.stopChan:
				return
			default:
				n, err := cpty.Read(buffer)
				if err != nil {
					if err != io.EOF {
						log.Printf("Error reading local terminal output: %v", err)
					}
					return
				}
				if n > 0 {
					// Use UTF-8 safe buffer to prevent character truncation
					// This is critical for Chinese/CJK characters that may be split across reads
					completeUTF8 := termSession.utf8Buffer.AppendAndFlush(buffer[:n])
					if completeUTF8 != "" {
						a.emitTerminalOutput(sessionID, completeUTF8)
					}
				}
			}
		}
	}()

	// Monitor the actual ConPTY process instead of disconnecting immediately.
	go a.monitorWindowsTerminalSession(sessionID, termSession, waitCtx, cpty)

	return nil
}

// ResizeLocalTerminal resizes the Windows ConPTY
func resizeLocalTerminal(termSession *TerminalSession, rows, cols int) error {
	windowsSessionsMu.RLock()
	winSession, exists := windowsSessions[termSession.SessionID]
	windowsSessionsMu.RUnlock()

	if !exists || winSession.ConPTY == nil {
		return fmt.Errorf("Windows ConPTY session not found")
	}

	err := winSession.ConPTY.Resize(cols, rows)
	if err != nil {
		return fmt.Errorf("failed to resize ConPTY: %v", err)
	}
	return nil
}

// CloseLocalTerminal closes the Windows ConPTY
func closeLocalTerminal(termSession *TerminalSession) {
	windowsSessionsMu.Lock()
	winSession, exists := windowsSessions[termSession.SessionID]
	if exists {
		delete(windowsSessions, termSession.SessionID)
	}
	windowsSessionsMu.Unlock()

	if exists && winSession.ConPTY != nil {
		if winSession.waitCancel != nil {
			winSession.waitCancel()
		}
		winSession.ConPTY.Close()
	}
}
