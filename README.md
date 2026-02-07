# XTerm File Manager (Go + Wails)

A modern, lightweight SSH terminal with integrated file manager. Built with Go (Wails) and React.

## Features

- **SSH Connection Management**: Automatically reads and parses `~/.ssh/config` file
- **Integrated File Manager**: Three-pane layout with SFTP file browser
  - Remote Files: Browse and manage files on SSH servers via SFTP
  - Local Files: Browse and manage local filesystem
  - Drag & drop file transfer between remote and local
- **File Operations**: 
  - **Double-click to edit**: Open files in floating independent editor window
  - **F2 to rename**: Quick rename for files and directories
  - Right-click context menu: Edit, Download, Upload, Delete, Rename
- **Modern Terminal**: Based on xterm.js with full terminal emulation
  - **Drag & Drop**: Drag files from Finder/Explorer to insert absolute path into terminal
- **Clipboard Support**: Cmd+C/V copy-paste, select-to-copy, right-click-paste
- **File Editor**: Multi-tab file editor with Notepad++-like features
  - **Drag & Drop**: Drag files from Finder/Explorer to open
  - **Multi-tab Interface**: Edit multiple files simultaneously
  - **Smart Tab Labels**: Long filename truncation with full path tooltip on hover
  - **Auto-save Location**: Files saved to ~/Documents/XTermFileManager by default
  - **Smart Naming**: Auto-increment (Untitled.txt, Untitled-1.txt, Untitled-2.txt...)
  - **Syntax Highlighting**: Support for 30+ programming languages via Monaco Editor
  - **Unsaved Changes Warning**: Visual indicator and confirmation dialog
- **Developer Tools**: Professional tools for developers
  - **JSON Formatter**: Tree view with expand/collapse, syntax highlighting (like json.cn)
  - **C Formatter**: Auto-format with configurable indent size
  - **Escape Tool**: Auto-convert escape sequences with toggle mode
- **Keyboard Shortcuts**: 
  - Ctrl+C: Copy (with selection) or interrupt (without selection)
  - Ctrl+D: Send EOF signal
  - F2: Rename selected file/directory
- **Preferences Menu**: Application menu with terminal settings (Preferences > Terminal)
- **Lightweight**: Built with Go + Wails, much lighter than Electron

## Changelog

### v2.27 - Security & Performance Improvements (2026-02-07)

**Security Enhancements:**
- SSH Host Key Verification: Implemented TOFU (Trust On First Use) strategy
  - Verifies host keys against `~/.ssh/known_hosts`
  - Auto-trusts new hosts and records fingerprint
  - Detects and blocks key mismatch attacks
- Fixed JSON marshal error handling (prevents silent failures)
- Fixed EOF error comparison (proper type checking instead of string comparison)

**Performance Optimizations:**
- SFTP Connection Pool: Reuses SFTP connections instead of creating/destroying per operation
- Removed excessive terminal output logging (eliminates per-byte logging overhead)
- Extracted magic numbers to named constants (IOBufferSize=32KB, SSHConnectTimeout=10s)

**Bug Fixes:**
- Debug log path: Changed from shared `/tmp` to user-specific directory
  - macOS: `~/Library/Logs/xterm-file-manager/debug.log`
  - Linux: `~/.cache/xterm-file-manager/debug.log`
- Added missing RenameLocalFile and RenameRemoteFile backend methods
- Deprecated CreatePTY method (goroutine leak risk, use StartTerminalSession instead)

### v2.26 - Terminal Drag & Drop Support (2026-02-07)

- **Terminal Drag & Drop**: Drag files from Finder/Explorer into Terminal to insert absolute path
  - Automatic path escaping for paths with spaces (wraps in quotes)
  - Multiple files separated by spaces (shell argument list format)
  - Visual feedback overlay when dragging files over terminal
  - Works with both local terminal and SSH sessions
  - Useful for quickly inserting file paths into commands without typing

### v2.25 - Editor Tab UX Optimization (2026-02-07)

- **Custom Tab Bar**: Replaced Ant Design Tabs with native scrollable tab bar
  - First tab pinned (position: sticky) — close button stays at fixed screen position
  - Click x repeatedly without moving mouse to close multiple files
  - Native `overflow-x: auto` for reliable sticky behavior
- **New Files Leftmost**: Latest opened files prepend to tab list (left-side insertion)
- **"..." File List Button**: Dropdown shows all open files with quick switch
- **Compact Tabs**: Tab width reduced to 90px (2x more visible tabs on screen)

### v2.24 - macOS Dock Menu Integration (2026-02-06)

- **Custom Dock Menu**: Right-click app icon in Dock shows all open editor windows
  - Dynamic window list updated in real-time as editors open/close
  - Click any window title to bring it to front
  - Current active window marked with checkmark (✓)
  - "Show All Editor Windows" command to bring all editors forward at once
  - Implemented via Objective-C Runtime (`class_addMethod`) injecting into Wails delegate
- **Window Menu Integration**: All editor windows appear in macOS menu bar Window menu
  - Auto-added via `addWindowsItem:` when editor opens
  - Auto-removed via delegate when editor closes
- **Fixed CGo Memory Management**: Eliminated use-after-free crash in async dispatch blocks
  - Synchronous NSString conversion before async operations
  - Proper strong references for all NSWindow instances
  - Clean delegate-based lifecycle management

### v2.23 - Native Independent Editor Window (2026-02-06)

- **Native macOS Independent Editor Window**: Double-click file opens in a real OS-level native window
  - CGo + NSWindow + WKWebView: True native macOS window, not a browser tab
  - Completely independent from Wails main window — interact with terminal and editor simultaneously
  - Copy from terminal → paste into editor freely between windows
  - Go backend HTTP server (127.0.0.1 only) serves Monaco Editor page
  - Dark theme matching VS Code, syntax highlighting for 30+ languages
  - Cmd+S to save, unsaved changes warning on close
  - Fallback textarea if Monaco CDN unavailable
  - Supports both remote (SFTP) and local file editing

### v2.22.1 - Editor UI Optimization (2026-02-06)

- **Tab Label UX Improvements**:
  - Smart filename truncation for long filenames (max 120px)
  - Full path tooltip on hover for easy identification
  - Fixed drag-and-drop overlay not clearing after file drop
- **Drag & Drop Refinements**:
  - Switched to Wails native `OnFileDrop` API for reliable file path handling
  - Added safety timeout (3s) to auto-clear drag overlay
  - Fixed WebView drag-and-drop integration with `DragAndDrop: true` flag

### v2.22 - File Editor Tab (2026-02-06)

- **New Editor Tab**: Multi-tab file editor with Notepad++-like capabilities
  - Drag & drop files from system to open
  - Create new files with auto-naming (Untitled.txt, Untitled-1.txt, etc.)
  - Default save location: ~/Documents/XTermFileManager
  - Open File button with file type filters
  - Monaco Editor with syntax highlighting for 30+ languages
  - Cmd+S keyboard shortcut for saving
  - Unsaved changes indicator and warning dialog
- **Backend APIs**: CreateLocalFile, GetDefaultEditorDirectory, GetNextUntitledFileName, OpenFileDialog
- **Wails Integration**: OnFileDrop API for reliable drag-and-drop support

### v2.22 - Enhanced Tools Tab (2026-02-06)

- **JSON Formatter**: Complete rewrite with tree view
  - Tree view with expand/collapse (+/- buttons) like json.cn
  - Syntax highlighting for keys, strings, numbers, booleans, null
  - Preview mode showing item counts when collapsed
  - Auto-format on input
  - Toggle between tree view and text view
- **C Formatter**: Enhanced with auto-format
  - Auto-format on input (no button needed)
  - Configurable indent size (2-8 spaces)
  - Better operator spacing and brace handling
- **Escape Tool**: Improved UX
  - Auto-convert on input
  - Toggle mode button for quick switching
  - Enhanced swap functionality (bidirectional)
  - More escape sequences (\\b, \\f, \\v)
  - Improved help documentation layout

### v2.21 - Project Structure Reorganization (2026-02-06)

- **Go code reorganization**: Moved all business logic to `internal/app/` package
- **Cleaner root directory**: Only `main.go` remains in project root
- **Standard Go layout**: Follows Go community best practices with `internal/` directory
- **Modular package structure**: Business code in `app` package, main only handles initialization
- **Updated Wails bindings**: Auto-generated bindings now in `frontend/wailsjs/go/app/`
- **Documentation organized**: All docs in `docs/`, scripts in `scripts/`

### v2.18 - File Operations Enhancement (2026-02-06)

- **Double-click to edit files**: Double-click any file (local or remote) to open in code editor
- **F2 rename shortcut**: Press F2 to rename selected files/directories
- **Context menu rename**: Added "Rename" option to right-click menu
- **Backend APIs**: Added `RenameRemoteFile()` and `RenameLocalFile()` functions
- **Keyboard shortcuts**: Verified Ctrl+C and Ctrl+D work correctly in terminal
- **User experience**: Seamless file editing and renaming workflow

### v2.10 - Build System, Display, Clipboard & Menu Fixes

- **Fixed wails.json**: Converted to flat colon-separated key format (`"frontend:install"`, `"frontend:build"`, `"frontend:dev:serverUrl"`) — the old nested format was silently ignored by Wails CLI, causing "No Install command" and the Vite dev server not starting
- **Fixed main.go assets**: Simplified asset server config — removed placeholder fallback, rely on Wails to handle dev/prod modes correctly via `wails.json`
- **Fixed clipboard**: Added standard macOS Edit menu (Copy/Paste/SelectAll) — required for Cmd+C/V to work in WebView
- **Fixed terminal borders**: Added `ResizeObserver` so the terminal reflows correctly when the container resizes (sidebar toggle, tab switch, layout changes)
- **Fixed server colors**: Overrode Ant Design's default dark text to light colors in the server list for dark theme visibility
- **Fixed menu structure**: Added standard macOS menus (App, Edit, Window) alongside the Preferences menu
- **Improved resize**: Debounced terminal resize to prevent rapid-fire calls; only process `keydown` events in keyboard handler to prevent double-fire

## Installation

### macOS (Apple Silicon / M1/M2/M3)

1. Download `xterm-file-manager-darwin-arm64.zip` from [Releases](https://github.com/xxddccaa/xterm-file-manager/releases)
2. Extract the ZIP file
3. You'll get `xterm-file-manager-darwin-arm64.app`

**Important - Fix "App is damaged" error (one-time setup):**

If you see "xterm-file-manager-darwin-arm64 is damaged and can't be opened", this is macOS Gatekeeper blocking unsigned apps. Fix it by running in Terminal:

```bash
# Remove quarantine attribute (only needed once)
xattr -cr xterm-file-manager-darwin-arm64.app
```

After removing the quarantine attribute, you can:
- Double-click the app to open it (no need to use `open` command anymore)
- Or install it to your system (see below)

**Install to Applications folder (recommended):**

1. Drag `xterm-file-manager-darwin-arm64.app` to your `/Applications` folder
2. The app will appear in Launchpad and Applications folder
3. You can launch it from there like any other app
4. No need to use Terminal commands after installation

### macOS (Intel)

1. Download `xterm-file-manager-darwin-amd64.zip` from [Releases](https://github.com/xxddccaa/xterm-file-manager/releases)
2. Extract the ZIP file to get `xterm-file-manager-darwin-amd64.app`
3. **If you see "App is damaged" error**, run in Terminal (one-time only):
   ```bash
   xattr -cr xterm-file-manager-darwin-amd64.app
   ```
4. Drag the app to `/Applications` folder to install (optional but recommended)

### Windows

1. Download `xterm-file-manager-windows-amd64.exe` from [Releases](https://github.com/xxddccaa/xterm-file-manager/releases)
2. Run the `.exe` file directly

## Usage

1. Launch the application
2. The app will automatically read your SSH config from `~/.ssh/config`
3. Select a server from the list to connect
4. Use the integrated terminal and file manager

**Note**: Make sure you have SSH keys configured in `~/.ssh/config` for the servers you want to connect to.

## Development

### Prerequisites

- Go 1.21+
- Node.js 18+
- Wails CLI: `go install github.com/wailsapp/wails/v2/cmd/wails@latest`

### Setup

```bash
# Install Go dependencies
go mod download

# Install frontend dependencies
cd frontend && npm install && cd ..

# Run in development mode (starts Vite + Go app automatically)
wails dev
```

### Development Mode (`wails dev`)

`wails dev` handles everything automatically:
1. Installs frontend dependencies (`npm install`)
2. Starts the Vite dev server with hot-reload
3. Compiles and runs the Go backend
4. Opens the app window loading from Vite

You just need to run `wails dev` — no manual frontend build needed.

### Clean Cache

If the UI is not updating after changes:

```bash
# Clean Vite cache and restart
cd frontend && rm -rf node_modules/.vite .vite && cd ..
wails dev
```

If that doesn't help, do a full clean:

```bash
# Full clean rebuild
rm -rf frontend/dist/assets frontend/dist/*.html frontend/dist/*.js
cd frontend && rm -rf node_modules/.vite .vite && npm install && cd ..
wails dev
```

> **Note**: Do NOT delete the entire `frontend/dist/` directory — it contains a `gitkeep` file needed by Go's `//go:embed` directive. Only delete the build outputs inside it.

### Production Build

```bash
# Build for current platform
wails build

# Build for specific platform
wails build -platform darwin/amd64
wails build -platform darwin/arm64
wails build -platform windows/amd64
wails build -platform linux/amd64
```

`wails build` automatically runs `npm install` + `npm run build` before compiling, so the production binary contains all frontend assets embedded.

## Project Structure

```
xterm-file-manager/
├── main.go                    # Application entry point
├── internal/
│   └── app/                   # Business logic (package app)
│       ├── app.go             # App struct, settings, lifecycle
│       ├── ssh.go             # SSH config parser (~/.ssh/config)
│       ├── ssh_manager.go     # SSH connection pool management
│       ├── websocket_handler.go  # Terminal PTY I/O (SSH + local)
│       ├── local_files.go     # File operations (local + SFTP)
│       ├── editor_server.go   # HTTP server for standalone editor
│       └── editor_window_darwin.go  # Native macOS window (CGo)
├── frontend/                  # React frontend
│   ├── src/
│   │   ├── components/
│   │   │   ├── terminal/      # Terminal components
│   │   │   ├── file-manager/  # File manager components
│   │   │   ├── editor/        # Code editor
│   │   │   ├── session/       # Session management
│   │   │   └── tools/         # Utility tools
│   │   └── main.tsx
│   ├── wailsjs/               # Auto-generated Wails bindings
│   │   └── go/app/            # Go -> JS bindings
│   └── package.json
├── docs/                      # Documentation
│   ├── QUICKSTART.md
│   ├── RELEASE.md
│   ├── RUN.md
│   ├── 工程总结.md
│   └── ...
├── scripts/                   # Scripts and configs
│   ├── karabiner-config.json
│   └── test-keyboard.sh
├── build/                     # Build resources
│   ├── appicon.png
│   └── bin/                   # Build output
├── go.mod
└── wails.json                 # Wails configuration
```

## License

MIT
