//go:build windows

package app

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"

	"github.com/UserExistsError/conpty"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// TerminalSessionWindows extends TerminalSession with Windows-specific fields
type TerminalSessionWindows struct {
	*TerminalSession
	ConPTY *conpty.ConPty // Windows ConPTY handle
}

var (
	windowsSessions   = make(map[string]*TerminalSessionWindows)
	windowsSessionsMu sync.RWMutex
)

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

	// Determine shell based on Windows environment
	shell := os.Getenv("COMSPEC") // Usually C:\Windows\system32\cmd.exe
	if shell == "" {
		// Try PowerShell first (more capable), fall back to cmd.exe
		if _, err := exec.LookPath("pwsh.exe"); err == nil {
			shell = "pwsh.exe"
		} else if _, err := exec.LookPath("powershell.exe"); err == nil {
			shell = "powershell.exe"
		} else {
			shell = "cmd.exe"
		}
	}

	// Create ConPTY with initial size
	cpty, err := conpty.Start(shell)
	if err != nil {
		return fmt.Errorf("failed to create ConPTY: %v", err)
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

	// Set environment variables
	// Note: Windows doesn't have VIRTUAL_ENV issues like Unix, but we keep the pattern
	cleanEnv := make([]string, 0, len(os.Environ()))
	for _, env := range os.Environ() {
		cleanEnv = append(cleanEnv, env)
	}
	cmd.Env = cleanEnv

	// Set initial ConPTY size
	err = cpty.Resize(cols, rows)
	if err != nil {
		cpty.Close()
		return fmt.Errorf("failed to set ConPTY initial size: %v", err)
	}

	log.Printf("✅ Started Windows terminal with shell: %s, size: %dx%d", shell, cols, rows)

	// Create terminal session with UTF-8 safe buffer
	termSession := &TerminalSession{
		SessionID:   sessionID,
		LocalCmd:    cmd,
		LocalPTY:    nil, // Not used on Windows
		LocalStdin:  cpty,
		stopChan:    make(chan struct{}),
		isConnected: true,
		isLocal:     true,
		utf8Buffer:  &UTF8SafeBuffer{}, // Prevent UTF-8 truncation in Windows terminal output
	}

	// Store Windows-specific session
	winSession := &TerminalSessionWindows{
		TerminalSession: termSession,
		ConPTY:          cpty,
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

	// Monitor process
	go func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("❌ PANIC RECOVERED in local terminal monitor goroutine for session %s: %v", sessionID, r)
			}
		}()

		// Wait for process to exit (ConPTY doesn't have cmd.Wait(), use pid monitoring)
		// For now, we rely on the read loop detecting EOF
		// TODO: Implement proper process monitoring via Windows API if needed

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
		winSession.ConPTY.Close()
	}
}
