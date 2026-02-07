# AGENTS.md - Developer Guide for Agentic Coding

This guide is for agentic coding agents working in the XTerm File Manager codebase.

## Project Overview

XTerm File Manager is a modern SSH terminal with integrated file manager built with:
- **Backend**: Go 1.23+ with Wails v2.11.0 framework
- **Frontend**: React 18.2 + TypeScript 5.2 + Vite 5.0
- **Key Libraries**: xterm.js (terminal), Monaco Editor (code editor), Ant Design (UI), SFTP (file transfers)

## Build/Lint/Test Commands

### Development
```bash
# Run in development mode (auto-starts Vite dev server + Go backend)
wails dev

# Clean Vite cache if UI not updating
cd frontend && rm -rf node_modules/.vite .vite && cd ..
wails dev

# Full clean rebuild
rm -rf frontend/dist/assets frontend/dist/*.html frontend/dist/*.js
cd frontend && rm -rf node_modules/.vite .vite && npm install && cd ..
wails dev
```

### Production Build
```bash
# Build for current platform
wails build

# Build for specific platforms
wails build -platform darwin/amd64     # macOS Intel
wails build -platform darwin/arm64     # macOS Apple Silicon
wails build -platform windows/amd64    # Windows
wails build -platform linux/amd64      # Linux
```

### Frontend Commands
```bash
cd frontend

# Install dependencies
npm install

# Run Vite dev server standalone (port auto-assigned)
npm run dev

# Build frontend for production
npm run build

# Preview production build
npm run preview
```

### Go Commands
```bash
# Install dependencies
go mod download

# Run Go backend tests (currently no test files)
go test ./...

# Run tests for specific package
go test ./internal/app

# Run single test function
go test -run TestFunctionName ./internal/app

# Run with verbose output
go test -v ./...

# Check for Go issues
go vet ./...

# Format Go code
go fmt ./...
```

### Code Generation
```bash
# Wails auto-generates Go->JS bindings in frontend/wailsjs/go/app/
# These are regenerated automatically during wails dev or wails build
```

## Project Structure

```
xterm-file-manager/
├── main.go                    # Application entry point
├── internal/app/              # Business logic (package app)
│   ├── app.go                 # App struct, settings, file operations
│   ├── ssh.go                 # SSH config parser
│   ├── ssh_manager.go         # SSH connection pool
│   ├── websocket_handler.go   # Terminal PTY I/O
│   ├── local_files.go         # Local + SFTP file operations
│   ├── editor_server.go       # HTTP server for editor
│   └── editor_window_darwin.go # Native macOS windows (CGo)
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── terminal/      # Terminal components
│   │   │   ├── file-manager/  # File manager components
│   │   │   ├── editor/        # Code editor
│   │   │   ├── session/       # Session management
│   │   │   └── tools/         # Utility tools
│   │   ├── utils/             # Utilities (logger, etc.)
│   │   └── main.tsx           # React entry point
│   ├── wailsjs/               # Auto-generated Wails bindings
│   │   └── go/app/            # Go -> TypeScript bindings
│   ├── tsconfig.json          # TypeScript config
│   └── package.json           # NPM config
├── build/                     # Build resources (icons, manifests)
├── docs/                      # Documentation
├── scripts/                   # Helper scripts
├── go.mod                     # Go dependencies
└── wails.json                 # Wails configuration
```

## Code Style Guidelines

### Go (Backend)

**Imports:**
```go
package app

import (
    // Standard library first
    "context"
    "fmt"
    "log"
    "os"
    
    // Third-party packages second (alphabetically)
    "github.com/creack/pty"
    "github.com/wailsapp/wails/v2/pkg/runtime"
    "golang.org/x/crypto/ssh"
)
```

**Naming Conventions:**
- Exported functions: `PascalCase` (e.g., `GetSSHConfig`, `WriteLocalFile`)
- Unexported functions: `camelCase` (e.g., `getSettingsPath`, `dirExists`)
- Struct fields: `PascalCase` (exported), `camelCase` (unexported)
- Constants: `PascalCase` (e.g., `IOBufferSize`, `SSHConnectTimeout`)

**Error Handling:**
```go
// Wrap errors with context
if err != nil {
    return fmt.Errorf("failed to read file: %v", err)
}

// Check specific error types
if os.IsNotExist(err) {
    // handle missing file
}

// Use io.EOF for end-of-stream (not string comparison)
if err == io.EOF {
    break
}
```

**Logging:**
```go
// Use log.Printf with emoji prefixes for visibility
log.Printf("⚠️ Failed to start editor server: %v", err)
log.Printf("🔐 New host key for %s (SHA256:%s)", host, fpStr)
```

**Concurrency:**
```go
// Use sync.RWMutex for shared state
type SSHSession struct {
    ID string
    mu sync.RWMutex
}

func (s *SSHSession) GetStatus() string {
    s.mu.RLock()
    defer s.mu.RUnlock()
    return s.status
}
```

**Constants:**
```go
// Extract magic numbers to named constants
const (
    IOBufferSize      = 32 * 1024  // 32KB buffer for I/O
    SSHConnectTimeout = 10         // seconds
    MaxUntitledFiles  = 1000
)
```

### TypeScript/React (Frontend)

**Imports:**
```typescript
// React first
import React, { useState, useEffect, useCallback, useRef } from 'react'

// Third-party libraries
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import { Button, Modal } from 'antd'

// Wails bindings
import { WriteToTerminal, StartTerminalSession } from '../../../wailsjs/go/app/App'
import { EventsOn } from '../../../wailsjs/runtime/runtime'

// Local utilities
import logger from '../../utils/logger'

// CSS last
import './Terminal.css'
```

**Naming Conventions:**
- Components: `PascalCase` (e.g., `Terminal`, `FileManager`)
- Props interfaces: `{ComponentName}Props` (e.g., `TerminalProps`)
- Functions: `camelCase` (e.g., `handleResize`, `loadFiles`)
- Event handlers: `handle{Event}` (e.g., `handleClick`, `handleKeyDown`)
- Constants: `UPPER_SNAKE_CASE` or `camelCase` for local

**Component Structure:**
```typescript
interface TerminalProps {
  sessionId: string
  sessionType: 'ssh' | 'local'
  isActive: boolean
}

const Terminal: React.FC<TerminalProps> = ({
  sessionId,
  sessionType,
  isActive,
}) => {
  // State hooks first
  const [loading, setLoading] = useState(false)
  
  // Refs second
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  
  // Callbacks third
  const handleResize = useCallback(() => {
    // implementation
  }, [sessionId])
  
  // Effects last
  useEffect(() => {
    // setup
    return () => {
      // cleanup
    }
  }, [dependencies])
  
  return <div ref={terminalRef} />
}

export default Terminal
```

**Types:**
- Use explicit types for props and state
- Prefer `interface` over `type` for object shapes
- Use TypeScript's strict mode (`strict: true` in tsconfig.json)

**Error Handling:**
```typescript
// Always catch promise rejections
WriteToTerminal(sessionId, data).catch((err) => {
  console.error('Failed to write to terminal:', err)
})

// Use try-catch for async/await
try {
  const result = await StartTerminalSession(sessionId, rows, cols)
} catch (error) {
  console.error('Failed to start session:', error)
}
```

**Logging:**
```typescript
// Use logger utility with emoji prefixes
import logger from '../../utils/logger'

logger.log('🎯 [Terminal] Installing custom key handler')
logger.log('✅ [Terminal] Cmd+C detected, copying selection')
logger.log('⚠️ [Terminal] No selection, sending interrupt')
logger.log('❌ [Terminal] Failed to copy:', err)
```

**React Patterns:**
- Use functional components with hooks (no class components)
- Use `useRef` to store values that don't trigger re-renders
- Use `useCallback` for event handlers passed to child components
- Clean up effects (timers, listeners, observers) in return function
- Prevent duplicate effect execution with guard refs (see Terminal.tsx:sessionStartedRef)

## Key Conventions

1. **File Paths**: Always handle `~` expansion in Go backend (use `os.UserHomeDir()`)
2. **Async Operations**: Always handle errors for Go backend calls from React
3. **Terminal I/O**: Use `IOBufferSize` constant (32KB) for buffer operations
4. **SSH Security**: Implement TOFU (Trust On First Use) for host key verification
5. **Resource Management**: Always close SFTP clients, file handles, WebSocket connections
6. **React StrictMode**: Guard against duplicate effect calls using refs
7. **Emoji Logging**: Use emoji prefixes for better log visibility (⚠️ 🔐 ✅ ❌ 🎯 📥)

## Common Patterns

### Wails Backend Method Exposure
```go
// In internal/app/app.go
func (a *App) MyNewMethod(param string) (string, error) {
    // implementation
    return result, nil
}
// Automatically available in frontend as: MyNewMethod(param)
```

### Frontend Wails Integration
```typescript
import { MyNewMethod } from '../../../wailsjs/go/app/App'

const result = await MyNewMethod(param)
```

### Event Emission (Go -> React)
```go
// Backend
runtime.EventsEmit(a.ctx, "terminal:output", payload)

// Frontend
EventsOn('terminal:output', (payload) => {
    // handle event
})
```

## Important Notes

- **Do NOT delete `frontend/dist/` directory** - contains `gitkeep` needed by Go's `//go:embed`
- **PTY Lifecycle**: Use `StartTerminalSession`, NOT deprecated `CreatePTY` (goroutine leak risk)
- **SFTP Pooling**: SFTP clients are pooled - don't close them in file operation functions
- **Wails Auto-generation**: Never manually edit files in `frontend/wailsjs/` - regenerated by Wails
- **Debug Logs**: Platform-specific paths: macOS `~/Library/Logs/xterm-file-manager/debug.log`, Linux `~/.cache/xterm-file-manager/debug.log`
