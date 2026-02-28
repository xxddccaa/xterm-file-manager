package app

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"

	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
)

// TerminalMessage represents a message sent over WebSocket
type TerminalMessage struct {
	Type      string `json:"type"`      // "input", "resize", "ping"
	Data      string `json:"data"`      // terminal input data
	SessionID string `json:"sessionId"` // SSH session ID
	Rows      int    `json:"rows"`      // terminal rows (for resize)
	Cols      int    `json:"cols"`      // terminal cols (for resize)
}

// TerminalSession represents a terminal session
type TerminalSession struct {
	SessionID   string
	SSHSession  *ssh.Session   // For SSH sessions
	LocalCmd    *exec.Cmd      // For local terminal sessions
	LocalPTY    *os.File       // PTY file for local sessions
	StdinPipe   io.WriteCloser // For SSH sessions
	LocalStdin  io.WriteCloser // For local sessions
	mu          sync.Mutex
	stopChan    chan struct{}
	stopOnce    sync.Once // Prevent double-close of stopChan
	isConnected bool
	isLocal     bool // true for local terminal, false for SSH

	// UTF-8 safe buffers to prevent character truncation at byte boundaries
	utf8Buffer   *UTF8SafeBuffer // For local terminal output
	stdoutBuffer *UTF8SafeBuffer // For SSH stdout
	stderrBuffer *UTF8SafeBuffer // For SSH stderr
}

var (
	terminalSessions = make(map[string]*TerminalSession)
	termSessionMu    sync.RWMutex
)

// StartTerminalSession starts a PTY session over WebSocket
func (a *App) StartTerminalSession(sessionID string, rows int, cols int) error {
	sshManager.mu.RLock()
	session, exists := sshManager.sessions[sessionID]
	sshManager.mu.RUnlock()

	if !exists {
		return fmt.Errorf("SSH session not found: %s", sessionID)
	}

	if !session.Connected || session.Client == nil {
		return fmt.Errorf("SSH session not connected")
	}

	// Create new SSH session for PTY
	sshSession, err := session.Client.NewSession()
	if err != nil {
		return fmt.Errorf("failed to create SSH session: %v", err)
	}

	// Set up terminal modes
	modes := ssh.TerminalModes{
		ssh.ECHO:          1,
		ssh.TTY_OP_ISPEED: 14400,
		ssh.TTY_OP_OSPEED: 14400,
	}

	// Request PTY
	if err := sshSession.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		sshSession.Close()
		return fmt.Errorf("failed to request PTY: %v", err)
	}

	// Try to set UTF-8 locale environment variables for proper Chinese/CJK character support.
	// Many SSH servers reject Setenv requests for security (AcceptEnv not configured),
	// so we silently ignore errors here. If the remote server doesn't accept these,
	// the user needs to configure their server's locale manually.
	_ = sshSession.Setenv("LANG", "en_US.UTF-8")
	_ = sshSession.Setenv("LC_ALL", "en_US.UTF-8")

	// Get pipes
	stdin, err := sshSession.StdinPipe()
	if err != nil {
		sshSession.Close()
		return fmt.Errorf("failed to get stdin: %v", err)
	}

	stdout, err := sshSession.StdoutPipe()
	if err != nil {
		sshSession.Close()
		return fmt.Errorf("failed to get stdout: %v", err)
	}

	stderr, err := sshSession.StderrPipe()
	if err != nil {
		sshSession.Close()
		return fmt.Errorf("failed to get stderr: %v", err)
	}

	// Start shell
	if err := sshSession.Shell(); err != nil {
		sshSession.Close()
		return fmt.Errorf("failed to start shell: %v", err)
	}

	// Create terminal session with UTF-8 safe buffers
	termSession := &TerminalSession{
		SessionID:    sessionID,
		SSHSession:   sshSession,
		StdinPipe:    stdin,
		stopChan:     make(chan struct{}),
		isConnected:  true,
		stdoutBuffer: &UTF8SafeBuffer{}, // Prevent UTF-8 truncation in stdout
		stderrBuffer: &UTF8SafeBuffer{}, // Prevent UTF-8 truncation in stderr
	}

	// Store session
	termSessionMu.Lock()
	terminalSessions[sessionID] = termSession
	termSessionMu.Unlock()

	// Start output readers (these will be sent via WebSocket events)
	go func() {
		defer func() {
			termSessionMu.Lock()
			if ts, ok := terminalSessions[sessionID]; ok {
				ts.isConnected = false
			}
			termSessionMu.Unlock()

			// Flush any remaining bytes when session ends
			if remaining := termSession.stdoutBuffer.Flush(); remaining != "" {
				a.emitTerminalOutput(sessionID, remaining)
			}
		}()

		buffer := make([]byte, IOBufferSize)
		for {
			select {
			case <-termSession.stopChan:
				return
			default:
				n, err := stdout.Read(buffer)
				if err != nil {
					if err != io.EOF {
						log.Printf("Error reading stdout: %v", err)
					}
					return
				}
				if n > 0 {
					// Use UTF-8 safe buffer to prevent character truncation
					completeUTF8 := termSession.stdoutBuffer.AppendAndFlush(buffer[:n])
					if completeUTF8 != "" {
						a.emitTerminalOutput(sessionID, completeUTF8)
					}
				}
			}
		}
	}()

	go func() {
		defer func() {
			// Flush any remaining bytes when session ends
			if remaining := termSession.stderrBuffer.Flush(); remaining != "" {
				a.emitTerminalOutput(sessionID, remaining)
			}
		}()

		buffer := make([]byte, IOBufferSize)
		for {
			select {
			case <-termSession.stopChan:
				return
			default:
				n, err := stderr.Read(buffer)
				if err != nil {
					if err != io.EOF {
						log.Printf("Error reading stderr: %v", err)
					}
					return
				}
				if n > 0 {
					// Use UTF-8 safe buffer to prevent character truncation
					completeUTF8 := termSession.stderrBuffer.AppendAndFlush(buffer[:n])
					if completeUTF8 != "" {
						a.emitTerminalOutput(sessionID, completeUTF8)
					}
				}
			}
		}
	}()

	// Monitor session
	go func() {
		sshSession.Wait()
		termSession.mu.Lock()
		termSession.isConnected = false
		termSession.mu.Unlock()
		termSession.stopOnce.Do(func() { close(termSession.stopChan) })

		// Emit disconnection event to frontend
		if a.ctx != nil {
			wailsRuntime.EventsEmit(a.ctx, "terminal:disconnected", map[string]interface{}{
				"sessionId": sessionID,
				"reason":    "SSH session ended",
			})
		}

		log.Printf("Terminal session ended: %s", sessionID)
	}()

	return nil
}

// WriteToTerminal writes data to the terminal stdin
func (a *App) WriteToTerminal(sessionID string, data string) error {
	termSessionMu.RLock()
	termSession, exists := terminalSessions[sessionID]
	termSessionMu.RUnlock()

	if !exists {
		return fmt.Errorf("terminal session not found: %s", sessionID)
	}

	if !termSession.isConnected {
		return fmt.Errorf("terminal session not connected")
	}

	termSession.mu.Lock()
	defer termSession.mu.Unlock()

	if termSession.isLocal {
		// Local terminal: write to PTY
		_, err := termSession.LocalStdin.Write([]byte(data))
		if err != nil {
			return fmt.Errorf("failed to write to local terminal: %v", err)
		}
	} else {
		// SSH terminal: write to stdin pipe
		_, err := termSession.StdinPipe.Write([]byte(data))
		if err != nil {
			return fmt.Errorf("failed to write to terminal: %v", err)
		}
	}

	return nil
}

// ResizeTerminal resizes the PTY
func (a *App) ResizeTerminal(sessionID string, rows int, cols int) error {
	termSessionMu.RLock()
	termSession, exists := terminalSessions[sessionID]
	termSessionMu.RUnlock()

	if !exists {
		return fmt.Errorf("terminal session not found: %s", sessionID)
	}

	if !termSession.isConnected {
		return fmt.Errorf("terminal session not connected")
	}

	if termSession.isLocal {
		// Local terminal: resize PTY (platform-specific)
		log.Printf("🖥️ [ResizeTerminal] Resizing LOCAL terminal %s to %dx%d (rows x cols)", sessionID, rows, cols)
		return resizeLocalTerminal(termSession, rows, cols)
	} else {
		// SSH terminal: request window change
		log.Printf("🌐 [ResizeTerminal] Resizing SSH terminal %s to %dx%d (rows x cols)", sessionID, rows, cols)
		err := termSession.SSHSession.WindowChange(rows, cols)
		if err != nil {
			log.Printf("❌ [ResizeTerminal] SSH WindowChange failed: %v", err)
			return fmt.Errorf("failed to resize terminal: %v", err)
		}
		log.Printf("✅ [ResizeTerminal] SSH terminal resized successfully")
	}

	return nil
}

// CloseTerminalSession closes a terminal session
func (a *App) CloseTerminalSession(sessionID string) error {
	termSessionMu.Lock()
	termSession, exists := terminalSessions[sessionID]
	if exists {
		delete(terminalSessions, sessionID)
	}
	termSessionMu.Unlock()

	if !exists {
		return fmt.Errorf("terminal session not found: %s", sessionID)
	}

	termSession.mu.Lock()
	defer termSession.mu.Unlock()

	if termSession.isConnected {
		termSession.stopOnce.Do(func() { close(termSession.stopChan) })
		if termSession.isLocal {
			// Local terminal: close PTY (platform-specific)
			closeLocalTerminal(termSession)
		} else {
			// SSH terminal: close SSH session
			if termSession.SSHSession != nil {
				termSession.SSHSession.Close()
			}
		}
		termSession.isConnected = false
	}

	return nil
}

// emitTerminalOutput sends terminal output to the frontend
func (a *App) emitTerminalOutput(sessionID string, data string) {
	// Use Wails runtime to emit event to frontend
	if a.ctx != nil {
		payload := map[string]interface{}{
			"sessionId": sessionID,
			"data":      data,
		}

		// Emit event to frontend
		wailsRuntime.EventsEmit(a.ctx, "terminal:output", payload)
		// Note: removed per-output logging to avoid performance overhead
		// in high-throughput scenarios (e.g. cat large file, compilation output)
	}
}
