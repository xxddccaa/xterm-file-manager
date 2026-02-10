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

### v2.38 - Tab Context Menu & Terminal Addons Upgrade (2026-02-10)

**New Features:**
- **Tab Right-Click Context Menu**: All tab-based views (Terminal, Editor, Files) now support right-click context menu with:
  - Close — close the clicked tab
  - Close All to the Left — close all tabs to the left of clicked tab
  - Close All to the Right — close all tabs to the right of clicked tab
  - Close All Others — close all tabs except the clicked one
  - Rename — rename the clicked tab
  - Disabled state for menu items when action not applicable (e.g. no tabs to the left)
- **Terminal Search**: `Cmd+F` / `Ctrl+F` opens in-terminal search bar with next/prev navigation and real-time highlighting

**Terminal Enhancements:**
- **xterm.js Package Upgrade**: Migrated from deprecated `xterm` to new `@xterm/xterm@5.5.0` package family
- **WebGL Renderer**: GPU-accelerated rendering with automatic fallback chain: WebGL → Canvas → DOM
- **Unicode 11 Support**: Correct rendering of emoji (😊) and CJK wide characters (占2列宽)
- **Clickable URLs**: URLs in terminal output are automatically detected and clickable
- **Inline Images**: Support for Sixel and iTerm2 inline image protocols

**Bug Fixes:**
- **Batch Tab Close**: Fixed batch close operations (Close Left/Right/Others) only closing one tab instead of all — caused by React state closure snapshot issue; now uses single-state-update pattern

### v2.37 - Drag & Drop Fix & Debug Log Tab (2026-02-09)

**Bug Fixes:**
- **In-App Drag & Drop to Terminal**: Fixed file drag from file managers to terminal inserting path
  - Root cause: Wails `DisableWebViewDrop: true` causes WKWebView to intercept ALL drop events at native Objective-C level — JavaScript `drop` events never fire
  - Solution: Use `dragend` event + shared memory module (`dragState.ts`) instead of `drop` + `dataTransfer`
  - Use `document.elementFromPoint()` during `dragover` to track cursor position over terminal/file-manager zones
- **Cross-Pane File Transfer**: Fixed drag-and-drop file transfer between remote and local file managers
  - Same root cause as above — `drop` never fires, so transfer logic moved to unified `dragend` handler
  - Remote-to-local (download) and local-to-remote (upload) both work via `dragend` + `setDragTarget()`
- **Drag-Over Visual State Stuck**: Fixed file manager `drag-over` CSS highlight not clearing after drop
  - Root cause: `setDragOver(false)` was only called in `drop` handler which never fires
  - Solution: File managers now listen for `dragend` on `window` to clear visual state
- **SSH Connection Failure**: Fixed `ConnectSSH` passing host string instead of full `SSHConfigEntry` object
  - Error: `json: cannot unmarshal string into Go value of type app.SSHConfigEntry`
  - Fixed in both `handleCreateSession` and `connectSessionIfNeeded` (lazy connect)

**New Features:**
- **Debug Log Tab**: Built-in Log tab for frontend debugging without browser DevTools
  - `dlog()` utility logs to in-memory buffer (max 500 entries) + `console.log`
  - Log tab with Copy All button for easy bug reporting
  - All drag-and-drop code instrumented with `dlog()` for traceability

**Files Changed:**
- **New**: `frontend/src/utils/dragState.ts` (shared drag payload + target zone tracking)
- **New**: `frontend/src/utils/debugLog.ts` (in-memory log collector)
- **New**: `frontend/src/components/log/LogTab.tsx` (debug log viewer UI)
- **Modified**: `frontend/src/App.tsx` (added Log tab)
- **Modified**: `frontend/src/components/terminal/TerminalTab.tsx` (dragend strategy, ConnectSSH fix)
- **Modified**: `frontend/src/components/file-manager/LocalFileManager.tsx` (dragState + dragend cleanup)
- **Modified**: `frontend/src/components/file-manager/FileManager.tsx` (dragState + dragend cleanup)
- **Modified**: `AGENTS.md` (WKWebView drop limitation, ConnectSSH parameter, Debug Log Tab docs)

### v2.34 - Terminal Enhancements & Configuration Fixes (2026-02-09)

**Bug Fixes:**
- **Local Terminal Chinese Input**: Fixed broken Chinese character input in local terminals
  - Added `LANG=en_US.UTF-8` and `LC_ALL=en_US.UTF-8` environment variables
  - Local terminal now matches SSH terminal behavior for multi-byte character support
- **Local Terminal Delete Key**: Fixed Delete/Backspace key showing garbled characters (`^?` or `^H`)
  - Added `TERM=xterm-256color` environment variable (matches SSH terminal configuration)
  - Terminal control sequences now work correctly

**Configuration Improvements:**
- **Vite Auto-Open Browser**: Disabled automatic browser tab opening during `wails dev`
  - Added `open: false` to `frontend/vite.config.ts`
  - Eliminates unnecessary browser tab at `http://localhost:5173/`

**Documentation:**
- Updated `AGENTS.md` with critical configuration settings section
  - Added "Vite Auto-Open Browser" must-disable configuration
  - Added "Local Terminal Environment Variables" must-set configuration
  - Prevents AI agents from repeating these common mistakes

**Files Changed:**
- **Backend**: `internal/app/pty_unix.go` (added TERM and UTF-8 locale environment variables)
- **Frontend**: `frontend/vite.config.ts` (disabled auto-open browser)
- **Documentation**: `AGENTS.md` (added Critical Configuration Settings section)

### v2.33 - Terminal Improvements & Windows Support (2026-02-08)

**Critical Fixes:**
- **Windows Local Terminal Support**: Implemented Windows ConPTY support for local terminals
  - Created platform-specific PTY implementations (`pty_unix.go` / `pty_windows.go`)
  - Windows now supports cmd.exe, PowerShell Core, and PowerShell 5
  - Fixed terminal not working on Windows at all
- **Linux Shell Fallback**: Fixed shell default (macOS → `/bin/zsh`, Linux → `/bin/bash`)
- **Session Cleanup Leak**: Fixed local terminal process leak when closing tabs
- **Double-Close Panic**: Added `sync.Once` guard to prevent `stopChan` double-close panic

**Improvements:**
- **Session ID Collision Fix**: Changed from `Unix()` to `UnixNano()` for unique IDs
- **Dead Code Cleanup**: Removed unused WebSocket field/import, deleted `SessionView.tsx`
- **File Rename**: `websocket_handler.go` → `terminal_handler.go` (more accurate)
- **Path Injection Fix**: Accept `initialDir` parameter in `StartLocalTerminalSession()` (safer than sending `cd` commands)
- **Disconnection Notification**: Backend emits `terminal:disconnected` event, terminal shows red disconnect message
- **Windows Keyboard Fixes**: Platform detection, `macOptionIsMeta` conditional, added Ctrl+Shift+C/V support (Linux/Windows terminal convention)

**New Dependencies:**
- Added: `github.com/UserExistsError/conpty` v0.1.4 (Windows ConPTY)
- Removed: `github.com/gorilla/websocket` (unused)

**Files Changed:**
- Backend: `internal/app/terminal_handler.go`, `internal/app/pty_unix.go` (new), `internal/app/pty_windows.go` (new), `internal/app/app.go`
- Frontend: `frontend/src/components/terminal/Terminal.tsx`, `frontend/src/components/terminal/TerminalTab.tsx`
- Documentation: Added `BUILD.md`, `docs/BUILD-RELEASE.md`, `docs/VERSION-RELEASE.md`, `build-release.sh` script

### v2.32 - Internationalization (i18n) Support (2026-02-08)

**New Features:**
- Full internationalization support with react-i18next
- Language switcher in Settings tab (English / 简体中文)
- 158+ UI strings translated across 7 modules (common, terminal, editor, files, sync, tools, settings)
- Ant Design components auto-sync with selected language
- User language preference persists across app restarts (saved to `~/Library/Application Support/xterm-file-manager/settings.json`)
- Settings tab: centralized location for language selection and terminal preferences

**Technical Implementation:**
- Backend: Added `Locale` field to `TerminalSettings` struct in Go
- Frontend: Integrated react-i18next with 7 namespace modules
- Language packs: 14 JSON files (7 modules × 2 languages)
- Real-time language switching without app restart
- Parameterized translations with variable interpolation (e.g., `t('connectedToHost', { host })`)

**Files Changed:**
- Backend: `internal/app/app.go` (added Locale field)
- Frontend: 10 components refactored (App, ToolsTab, EditorTab, TerminalTab, SessionView, FileManager, LocalFileManager, FilesTab, SyncPanel, SettingsTab)
- New: `frontend/src/i18n/` directory with initialization config and 14 language pack JSON files
- New: `frontend/src/components/settings/SettingsTab.tsx` component

### v2.31 - File Association & Open With (2026-02-08)

**New Features:**
- File Association: register as default app for 38+ file types (txt, json, md, yaml, go, py, js, ts, etc.)
- macOS "Open With" support: right-click any supported file in Finder/Feishu -> Open With -> XTerm File Manager
- macOS `OnFileOpen` callback with queue mechanism (handles files opened before app startup)
- Windows file association via command-line args (`os.Args`), opens files in main window EditorTab
- Cross-platform `editor:open-file` Wails event for backend-to-frontend file open requests

**Platform Behavior:**
- macOS: opens files in native NSWindow + WKWebView (Monaco Editor)
- Windows/Linux: opens files in main window EditorTab (Monaco Editor)

### v2.30 - Local File Browser (2026-02-08)

**New Features:**
- Local File Browser tab (Files) with multi-tab support, Windows-style navigation (back/forward/up), breadcrumb path bar, and status bar
- Finder drag-and-drop: drag files/folders from macOS Finder to open in Files tab
- File operations: copy/cut/paste, rename (Enter or F2), delete, new file/folder
- Right-click context menu for all file operations
- Terminal integration: one-click open terminal at current directory
- Pop-out window: drag tab out to open in native macOS NSWindow
- Independent editor window for double-click file editing

**Bug Fixes:**
- Fixed TDZ error ("Cannot access 'u' before initialization") caused by referencing `const` before declaration in minified build
- Fixed + button only working once (was deduplicating same-path tabs)
- Fixed Finder drag-drop not working (missing `--wails-drop-target: drop` CSS property)
- Added Enter key as rename shortcut (F2 doesn't work on macOS)

### v2.28 - Build Process & Paste Fix (2026-02-08)

**Build Process:**
- Documented correct production build steps to avoid stale cache issues
- Added one-liner build command for quick rebuild
- `build/bin/*` can be safely deleted; `frontend/dist/` directory itself must be preserved (`gitkeep`)
- Must always clean Vite cache + use `-clean` flag + kill old process before opening

**Bug Fixes:**
- Reverted Terminal.tsx paste handling to v2.25 stable version (bracketed paste mode for multiline)
- Fixed paste in vim: removed broken "paste as-is" change that caused issues
- Restored correct Ctrl+V exclusion from macOS Ctrl passthrough rule

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

### Quick Links

- **📦 [发版编译指南](docs/BUILD-RELEASE.md)** - 如何编译发版到 `build/releases/`
- **🚀 开发模式** - 下面是开发相关的命令

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

#### 🚀 一键发版编译（推荐）

使用自动化脚本编译发版到 `build/releases/` 目录：

```bash
# macOS Apple Silicon (M1/M2/M3) - 默认
./build-release.sh

# 或者指定平台
./build-release.sh darwin-arm64   # macOS Apple Silicon
./build-release.sh darwin-amd64   # macOS Intel
./build-release.sh windows        # Windows 64-bit
./build-release.sh linux          # Linux 64-bit
./build-release.sh all            # 编译所有平台
```

**脚本自动完成：**
1. ✅ 清理所有缓存（Vite、build 产物）
2. ✅ 检查并安装依赖
3. ✅ 编译指定平台
4. ✅ 打包到 `build/releases/`
5. ✅ 显示文件大小和路径

**输出文件格式：**
- macOS: `xterm-file-manager-v{version}-darwin-arm64.zip`（包含 .app）
- Windows: `xterm-file-manager-v{version}-windows-amd64.exe`
- Linux: `xterm-file-manager-v{version}-linux-amd64.tar.gz`

#### 📝 手动编译（开发测试用）

**Every build must follow these steps**, otherwise you may get stale cached code:

```bash
# Step 1: Clean all caches (REQUIRED every time)
rm -rf build/bin/*                                          # 可以随便删，只有编译产物
rm -rf frontend/dist/assets                                 # 只删 assets，不要删 dist/ 目录本身
cd frontend && rm -rf node_modules/.vite .vite && cd ..     # 清 Vite 缓存

# Step 2: Build
wails build -platform darwin/arm64 -clean

# Step 3: Kill old process before opening (macOS may reuse old instance)
pkill -f xterm-file-manager 2>/dev/null; sleep 1

# Step 4: Open the new build
open build/bin/xterm-file-manager.app
```

**Build for other platforms** (still need Step 1 first):

```bash
wails build -platform darwin/amd64 -clean   # macOS Intel
wails build -platform windows/amd64 -clean  # Windows
wails build -platform linux/amd64 -clean    # Linux
```

**One-liner for quick rebuild (macOS Apple Silicon):**

```bash
rm -rf build/bin/* frontend/dist/assets && cd frontend && rm -rf node_modules/.vite .vite && cd .. && wails build -platform darwin/arm64 -clean && pkill -f xterm-file-manager 2>/dev/null; sleep 1; open build/bin/xterm-file-manager.app
```

> **Important notes:**
> - Always use `-clean` flag to avoid stale binaries
> - Always clean Vite cache before building — Vite may serve old bundled JS otherwise
> - Do NOT delete the entire `frontend/dist/` directory — it contains a `gitkeep` file needed by Go's `//go:embed`
> - Always kill the old process before opening — macOS may reuse the already-running old instance instead of launching the new build

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
