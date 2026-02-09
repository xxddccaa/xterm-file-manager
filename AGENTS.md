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
# IMPORTANT: Always clean caches before building
rm -rf build/bin/* frontend/dist/assets
cd frontend && rm -rf node_modules/.vite .vite && cd ..

# Build for specific platforms (always use -clean flag)
wails build -platform darwin/arm64 -clean    # macOS Apple Silicon
wails build -platform darwin/amd64 -clean    # macOS Intel
wails build -platform windows/amd64 -clean   # Windows
wails build -platform linux/amd64 -clean     # Linux

# Re-sign with entitlements to remove sandbox restrictions
./scripts/post-build-sign.sh

# Kill old process before opening new build (macOS reuses running instances)
pkill -f xterm-file-manager 2>/dev/null; sleep 1
open build/bin/xterm-file-manager.app

# One-liner for quick rebuild (macOS Apple Silicon):
rm -rf build/bin/* frontend/dist/assets && cd frontend && rm -rf node_modules/.vite .vite && cd .. && wails build -platform darwin/arm64 -clean && ./scripts/post-build-sign.sh && pkill -f xterm-file-manager 2>/dev/null; sleep 1; open build/bin/xterm-file-manager.app
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
8. **SSH Config Auto-Reload**: When `~/.ssh/config` is saved (via WriteLocalFile/WriteRemoteFile), `ssh:config-changed` event triggers frontend to reload SSH config list immediately (app.go:258, TerminalTab.tsx:79, SyncPanel.tsx:128)
9. **Tab Drag and Drop**: Both Terminal tabs and Editor tabs support HTML5 native drag-and-drop for reordering. Implementation uses `draggable={true}`, `onDragStart`, `onDragOver`, and `onDragEnd` handlers with real-time array reordering and visual feedback (opacity 0.5 during drag, grab/grabbing cursors)
10. **Session Persistence**: Terminal sessions and Editor tabs are auto-saved to `~/Library/Application Support/xterm-file-manager/sessions.json` and `editor-tabs.json`. Sessions restore on app startup with auto-reconnection for SSH and local terminals. Editor tabs restore with error handling for missing files.
11. **Wails WKWebView Drop Event Limitation (CRITICAL)**: When `DragAndDrop.DisableWebViewDrop: true` is set in `main.go`, the native WKWebView on macOS intercepts ALL drop operations at the Objective-C level (`WailsWebView.m:performDragOperation`). This means **JavaScript `drop` events NEVER fire** — not for OS-level drags, and not for in-app HTML5 drags. Only `dragend` fires. The workaround is:
    - Use a **shared memory module** (`frontend/src/utils/dragState.ts`) instead of `dataTransfer.getData()` to pass drag payloads between components
    - Use **`dragend` on `window` (capture phase)** instead of `drop` to detect when the user releases the mouse
    - Use **`document.elementFromPoint()`** during `dragover` to track which zone (terminal-pane / local-file-manager / file-manager-container) the cursor is over
    - Store the target zone in `dragState.setDragTarget()` and read it in the `dragend` handler
    - File managers must also use `dragend` (via window listener) to clear their `dragOver` visual state, since `drop` (which normally clears it) never fires
12. **ConnectSSH Parameter**: `ConnectSSH()` in Go backend accepts a full `SSHConfigEntry` object, NOT a host string. Always pass the complete config object from `sshConfigs` state.
13. **Frontend Debug Log Tab**: The app includes a built-in **Log tab** (`frontend/src/components/log/LogTab.tsx`) for debugging frontend issues without browser DevTools. Since Wails WKWebView doesn't expose DevTools in production, this is the primary debugging tool.
    - Import `dlog` from `frontend/src/utils/debugLog.ts` and call `dlog('message')` to log messages
    - Logs are stored in memory (max 500 entries) and displayed in the Log tab in the main UI
    - Log tab has **Copy All** button to copy all logs for pasting into bug reports
    - `dlog()` also mirrors to `console.log` for development mode
    - All drag-and-drop related code uses `dlog()` for traceability

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

### Tab Drag-and-Drop Reordering

Both Terminal tabs and Editor tabs support HTML5 native drag-and-drop for reordering tabs. This feature provides an intuitive way to organize multiple open sessions or files.

#### Implementation Overview

**Key Features**:
- HTML5 native Drag and Drop API (zero dependencies)
- Real-time visual feedback during drag (opacity 0.5, grab/grabbing cursors)
- Smooth array reordering with live preview
- Prevents text selection during drag with `user-select: none`
- Hover animation with `transform: translateY(-2px)`

#### Terminal Tab Implementation

**File**: `frontend/src/components/terminal/TerminalTab.tsx`

```typescript
// State for tracking drag operation
const [draggedTabIndex, setDraggedTabIndex] = useState<number | null>(null)

// Drag start handler
const handleTabDragStart = useCallback((e: React.DragEvent, index: number) => {
  setDraggedTabIndex(index)
  e.dataTransfer.effectAllowed = 'move'
  e.dataTransfer.setData('text/plain', index.toString())
  
  // Visual feedback: semi-transparent during drag
  if (e.currentTarget instanceof HTMLElement) {
    e.currentTarget.style.opacity = '0.5'
  }
}, [])

// Drag over handler: real-time reordering
const handleTabDragOver = useCallback((e: React.DragEvent, index: number) => {
  e.preventDefault()
  e.stopPropagation()
  e.dataTransfer.dropEffect = 'move'
  
  if (draggedTabIndex === null || draggedTabIndex === index) return
  
  // Reorder sessions array immediately for live preview
  const newSessions = [...sessions]
  const [draggedSession] = newSessions.splice(draggedTabIndex, 1)
  newSessions.splice(index, 0, draggedSession)
  setSessions(newSessions)
  setDraggedTabIndex(index) // Update dragged index
}, [draggedTabIndex, sessions])

// Drag end handler: cleanup
const handleTabDragEnd = useCallback((e: React.DragEvent) => {
  if (e.currentTarget instanceof HTMLElement) {
    e.currentTarget.style.opacity = '1'
  }
  setDraggedTabIndex(null)
}, [])

// JSX: Add drag attributes to each tab
{sessions.map((session, index) => (
  <div
    key={session.id}
    className={`session-tab ${activeSessionId === session.id ? 'active' : ''}`}
    draggable={true}
    onDragStart={(e) => handleTabDragStart(e, index)}
    onDragOver={(e) => handleTabDragOver(e, index)}
    onDragEnd={handleTabDragEnd}
    onClick={() => setActiveSessionId(session.id)}
  >
    {/* Tab content */}
  </div>
))}
```

**CSS** (`TerminalTab.css`):

```css
.session-tabs {
  user-select: none; /* Prevent text selection during drag */
}

.session-tab {
  cursor: pointer;
  transition: background 0.2s, transform 0.2s;
}

.session-tab[draggable="true"] {
  cursor: grab;
}

.session-tab[draggable="true"]:active {
  cursor: grabbing;
}

.session-tab:hover {
  background: #303030;
  transform: translateY(-2px); /* Subtle lift effect */
}
```

#### Editor Tab Implementation

**File**: `frontend/src/components/editor/EditorTab.tsx`

Implementation is nearly identical to Terminal tabs, with the following differences:

1. **State**: Uses `files` array instead of `sessions`
2. **First Tab Sticky Fix**: Temporarily disables `position: sticky` during drag to allow smooth reordering

```css
/* Pin first tab so close-button stays at fixed screen position */
.custom-tab:first-child {
  position: sticky;
  left: 0;
  z-index: 10;
}

/* Temporarily disable sticky during drag */
.custom-tab:first-child:active {
  position: relative;
}
```

#### Key Technical Details

1. **Why `index` instead of `id`**: Array indices are used for reordering logic because they represent the tab's visual position
2. **Real-time Updates**: `setSessions` / `setFiles` is called immediately in `onDragOver` for live preview
3. **Drag Index Update**: After reordering, `setDraggedTabIndex(index)` updates the tracked index to the new position
4. **Opacity Reset**: `onDragEnd` restores opacity to 1 and clears drag state
5. **Event Propagation**: `e.stopPropagation()` prevents drag events from bubbling to parent file drag handlers

#### Testing Scenarios

- ✅ Drag first tab to last position
- ✅ Drag last tab to first position
- ✅ Drag middle tab to any position
- ✅ Fast consecutive drags
- ✅ Drag active tab (maintains focus)
- ✅ Single tab (no drag allowed by nature)
- ✅ Multiple tabs with scroll (tabs reorder correctly)

#### Browser Compatibility

- Chrome/Edge: Full support
- Firefox: Full support  
- Safari: Full support
- Touch devices: Requires additional `touch-action` CSS for mobile support (not implemented)

## Important Notes

- **Do NOT delete `frontend/dist/` directory** - contains `gitkeep` needed by Go's `//go:embed`
- **PTY Lifecycle**: Use `StartTerminalSession`, NOT deprecated `CreatePTY` (goroutine leak risk)
- **SFTP Pooling**: SFTP clients are pooled - don't close them in file operation functions
- **Wails Auto-generation**: Never manually edit files in `frontend/wailsjs/` - regenerated by Wails
- **Debug Logs**: Platform-specific paths: macOS `~/Library/Logs/xterm-file-manager/debug.log`, Linux `~/.cache/xterm-file-manager/debug.log`

## Critical Configuration Settings

### Vite Auto-Open Browser (MUST DISABLE)

**Problem**: When running `wails dev`, Vite automatically opens a browser tab at `http://localhost:5173/`, which is unnecessary since the Wails app window is the intended interface.

**Solution**: In `frontend/vite.config.ts`, the `server.open` option MUST be set to `false`:

```typescript
// frontend/vite.config.ts
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    open: false, // CRITICAL: Prevent auto-opening browser in wails dev mode
  },
  // ... rest of config
})
```

**Why this matters**: Without this setting, every `wails dev` session wastes user attention by opening an unwanted browser tab.

### Local Terminal Environment Variables (MUST SET)

**Problem**: Local terminal sessions had broken Chinese input and Delete key behavior, while SSH terminals worked correctly.

**Root Cause**: Local terminals were missing proper `TERM` type and UTF-8 locale environment variables that SSH terminals automatically receive.

**Solution**: In `internal/app/pty_unix.go`, the following environment variables MUST be set:

```go
// internal/app/pty_unix.go (StartLocalTerminalSession function)
// Set environment variables
cleanEnv := make([]string, 0, len(os.Environ()))
termSet := false
for _, env := range os.Environ() {
    if len(env) >= 11 && env[:11] == "VIRTUAL_ENV" {
        continue // skip VIRTUAL_ENV
    }
    if len(env) >= 5 && env[:5] == "TERM=" {
        termSet = true
    }
    cleanEnv = append(cleanEnv, env)
}

// CRITICAL: Set TERM to xterm-256color if not already set
// This fixes Delete key and Chinese input issues
if !termSet {
    cleanEnv = append(cleanEnv, "TERM=xterm-256color")
}

// CRITICAL: Set UTF-8 locale for proper Chinese character support
cleanEnv = append(cleanEnv, "LANG=en_US.UTF-8")
cleanEnv = append(cleanEnv, "LC_ALL=en_US.UTF-8")
cmd.Env = cleanEnv
```

**Key Points**:
- `TERM=xterm-256color`: Matches SSH terminal configuration (see `terminal_handler.go:72`), enables proper terminal control sequences
- `LANG=en_US.UTF-8` and `LC_ALL=en_US.UTF-8`: Enable UTF-8 multi-byte character support for Chinese/Japanese/Korean input
- Without these: Delete key shows `^?` or `^H`, Chinese characters become garbled
- With these: Local terminal behaves identically to SSH terminal

**Testing**:
1. Open local terminal
2. Test Delete/Backspace key - should delete characters normally
3. Input Chinese characters - should display correctly
4. Compare with SSH terminal - should behave identically

### File Manager Default Behavior (MUST SHOW HIDDEN FILES)

**Problem**: File managers were showing "Empty Directory" on servers where only hidden files exist (e.g., servers with only dotfiles like `.bashrc`, `.ssh`, `.config` in `/root`).

**Root Cause**: The `showHidden` state defaulted to `false`, filtering out all files starting with `.` from display, even though the SFTP connection and file listing worked correctly.

**Solution**: Both file managers MUST default to showing hidden files:

```typescript
// frontend/src/components/file-manager/FileManager.tsx:60
const [showHidden, setShowHidden] = useState(true);  // MUST be true

// frontend/src/components/file-manager/LocalFileManager.tsx:53
const [showHidden, setShowHidden] = useState(true);  // MUST be true
```

**Why this matters**: 
- Many Linux servers store configuration and important files as hidden files (dotfiles)
- Without showing hidden files by default, users may think SFTP connection failed when it's actually working
- Matches behavior of most professional file managers (VS Code, FileZilla, etc.) which show all files by default

**Affected Code**:
- Remote file filtering: `FileManager.tsx:441-443`
- Local file filtering: `LocalFileManager.tsx:384-386`
```typescript
const filteredFiles = showHidden
  ? files
  : files.filter(f => !f.name.startsWith('.'));
```

**Testing**:
1. Connect to SSH server with only dotfiles in home directory
2. Open file manager - should display all files including `.bashrc`, `.ssh`, etc.
3. Verify both remote and local file managers show hidden files
