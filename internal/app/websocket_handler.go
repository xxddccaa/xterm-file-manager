package app

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
	"github.com/wailsapp/wails/v2/pkg/runtime"
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

// TerminalSession represents a WebSocket terminal session
type TerminalSession struct {
	SessionID   string
	SSHSession  *ssh.Session // For SSH sessions
	LocalCmd    *exec.Cmd    // For local terminal sessions
	LocalPTY    *os.File     // PTY file for local sessions
	WebSocket   *websocket.Conn
	StdinPipe   io.WriteCloser // For SSH sessions
	LocalStdin  io.WriteCloser // For local sessions
	mu          sync.Mutex
	stopChan    chan struct{}
	isConnected bool
	isLocal     bool // true for local terminal, false for SSH
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

	// Create terminal session
	termSession := &TerminalSession{
		SessionID:   sessionID,
		SSHSession:  sshSession,
		StdinPipe:   stdin,
		stopChan:    make(chan struct{}),
		isConnected: true,
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
					// Emit event to frontend via Wails runtime
					data := string(buffer[:n])
					a.emitTerminalOutput(sessionID, data)
				}
			}
		}
	}()

	go func() {
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
					data := string(buffer[:n])
					a.emitTerminalOutput(sessionID, data)
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
		close(termSession.stopChan)
		log.Printf("Terminal session ended: %s", sessionID)
	}()

	return nil
}

// StartLocalTerminalSession starts a local PTY session
func (a *App) StartLocalTerminalSession(sessionID string, rows int, cols int) error {
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
		shell = "/bin/zsh"
	}

	// Create command
	cmd := exec.Command(shell)

	// Set environment variables
	cmd.Env = os.Environ()

	// Create PTY
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

	// Create terminal session
	termSession := &TerminalSession{
		SessionID:   sessionID,
		LocalCmd:    cmd,
		LocalPTY:    ptmx,
		LocalStdin:  ptmx,
		stopChan:    make(chan struct{}),
		isConnected: true,
		isLocal:     true,
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
					data := string(buffer[:n])
					a.emitTerminalOutput(sessionID, data)
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
		close(termSession.stopChan)
		log.Printf("Local terminal session ended: %s", sessionID)
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
		// Local terminal: resize PTY
		if termSession.LocalPTY != nil {
			err := pty.Setsize(termSession.LocalPTY, &pty.Winsize{
				Rows: uint16(rows),
				Cols: uint16(cols),
			})
			if err != nil {
				return fmt.Errorf("failed to resize local terminal: %v", err)
			}
		}
	} else {
		// SSH terminal: request window change
		err := termSession.SSHSession.WindowChange(rows, cols)
		if err != nil {
			return fmt.Errorf("failed to resize terminal: %v", err)
		}
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
		close(termSession.stopChan)
		if termSession.isLocal {
			// Local terminal: close PTY and kill process
			if termSession.LocalPTY != nil {
				termSession.LocalPTY.Close()
			}
			if termSession.LocalCmd != nil && termSession.LocalCmd.Process != nil {
				termSession.LocalCmd.Process.Kill()
			}
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
		runtime.EventsEmit(a.ctx, "terminal:output", payload)
		// Note: removed per-output logging to avoid performance overhead
		// in high-throughput scenarios (e.g. cat large file, compilation output)
	}
}
