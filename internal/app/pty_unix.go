//go:build !windows

package app

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"runtime"

	"github.com/creack/pty"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// StartLocalTerminalSession starts a local PTY session using Unix PTY
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

	// Determine shell based on OS
	shell := os.Getenv("SHELL")
	if shell == "" {
		// Default to zsh on macOS, bash on Linux
		if runtime.GOOS == "darwin" {
			shell = "/bin/zsh"
		} else {
			shell = "/bin/bash"
		}
	}

	// Create command
	cmd := exec.Command(shell)

	// Set initial working directory if provided and valid
	if initialDir != "" {
		if stat, err := os.Stat(initialDir); err == nil && stat.IsDir() {
			cmd.Dir = initialDir
		} else {
			log.Printf("⚠️ Invalid initial directory %s, using default", initialDir)
		}
	}

	// Set environment variables, filtering out Python venv variables
	// that may have been inherited from the parent process.
	// A child shell won't have the 'deactivate' function defined,
	// so inheriting VIRTUAL_ENV causes errors in shell hooks.
	cleanEnv := make([]string, 0, len(os.Environ()))
	termSet := false
	for _, env := range os.Environ() {
		if len(env) >= 11 && env[:11] == "VIRTUAL_ENV" {
			continue // skip VIRTUAL_ENV and VIRTUAL_ENV_PROMPT
		}
		if len(env) >= 5 && env[:5] == "TERM=" {
			termSet = true
		}
		cleanEnv = append(cleanEnv, env)
	}
	// Set TERM to xterm-256color if not already set (fixes Chinese input and delete key)
	if !termSet {
		cleanEnv = append(cleanEnv, "TERM=xterm-256color")
	}
	// Set LANG to UTF-8 locale for proper Chinese character support
	cleanEnv = append(cleanEnv, "LANG=en_US.UTF-8")
	cleanEnv = append(cleanEnv, "LC_ALL=en_US.UTF-8")
	cmd.Env = cleanEnv

	// Create PTY using creack/pty (Unix-specific)
	ptmx, err := pty.Start(cmd)
	if err != nil {
		return fmt.Errorf("failed to start local terminal: %v", err)
	}

	// Set initial size
	if err := pty.Setsize(ptmx, &pty.Winsize{
		Rows: uint16(rows),
		Cols: uint16(cols),
	}); err != nil {
		ptmx.Close()
		cmd.Process.Kill()
		return fmt.Errorf("failed to set PTY size: %v", err)
	}

	// Create terminal session with UTF-8 safe buffer
	termSession := &TerminalSession{
		SessionID:   sessionID,
		LocalCmd:    cmd,
		LocalPTY:    ptmx,
		LocalStdin:  ptmx,
		stopChan:    make(chan struct{}),
		isConnected: true,
		isLocal:     true,
		utf8Buffer:  &UTF8SafeBuffer{}, // Prevent UTF-8 truncation in local terminal output
	}

	// Store session (overwrite placeholder with fully initialized session)
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
				n, err := ptmx.Read(buffer)
				if err != nil {
					if err != io.EOF {
						log.Printf("Error reading local terminal output: %v", err)
					}
					return
				}
				if n > 0 {
					// Use UTF-8 safe buffer to prevent character truncation
					// This is critical when window resizing triggers large output bursts
					completeUTF8 := termSession.utf8Buffer.AppendAndFlush(buffer[:n])
					if completeUTF8 != "" {
						a.emitTerminalOutput(sessionID, completeUTF8)
					}
				}
			}
		}
	}()

	// Monitor process
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("❌ PANIC RECOVERED in local terminal monitor goroutine for session %s: %v", sessionID, r)
			}
		}()

		cmd.Wait()
		termSession.mu.Lock()
		termSession.isConnected = false
		termSession.mu.Unlock()
		termSession.stopOnce.Do(func() { close(termSession.stopChan) })

		// Emit disconnection event to frontend
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "terminal:disconnected", map[string]interface{}{
				"sessionId": sessionID,
				"reason":    "Process exited",
			})
		}

		log.Printf("Local terminal session ended: %s", sessionID)
	}()

	return nil
}

// ResizeLocalTerminal resizes the Unix PTY
func resizeLocalTerminal(termSession *TerminalSession, rows, cols int) error {
	log.Printf("🔧 [ResizeLocalTerminal] Attempting to resize local terminal to %dx%d (rows x cols)", rows, cols)
	if termSession.LocalPTY != nil {
		err := pty.Setsize(termSession.LocalPTY, &pty.Winsize{
			Rows: uint16(rows),
			Cols: uint16(cols),
		})
		if err != nil {
			log.Printf("❌ [ResizeLocalTerminal] Failed to resize: %v", err)
			return fmt.Errorf("failed to resize local terminal: %v", err)
		}
		log.Printf("✅ [ResizeLocalTerminal] Successfully resized to %dx%d (rows x cols)", rows, cols)
	} else {
		log.Printf("⚠️ [ResizeLocalTerminal] LocalPTY is nil, cannot resize")
	}
	return nil
}

// CloseLocalTerminal closes the Unix PTY
func closeLocalTerminal(termSession *TerminalSession) {
	// Local terminal: close PTY and kill process
	if termSession.LocalPTY != nil {
		termSession.LocalPTY.Close()
	}
	if termSession.LocalCmd != nil && termSession.LocalCmd.Process != nil {
		termSession.LocalCmd.Process.Kill()
	}
}
