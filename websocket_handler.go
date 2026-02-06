package main

import (
	"fmt"
	"io"
	"log"
	"sync"

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
	SSHSession  *ssh.Session
	WebSocket   *websocket.Conn
	StdinPipe   io.WriteCloser
	mu          sync.Mutex
	stopChan    chan struct{}
	isConnected bool
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

		buffer := make([]byte, 32*1024)
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
		buffer := make([]byte, 32*1024)
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

	_, err := termSession.StdinPipe.Write([]byte(data))
	if err != nil {
		return fmt.Errorf("failed to write to terminal: %v", err)
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

	// Request window change
	err := termSession.SSHSession.WindowChange(rows, cols)
	if err != nil {
		return fmt.Errorf("failed to resize terminal: %v", err)
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
		termSession.SSHSession.Close()
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
		log.Printf("Terminal output [%s]: %d bytes", sessionID, len(data))
	}
}
