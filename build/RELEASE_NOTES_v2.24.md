# XTerm File Manager v2.24 Release Notes

Release Date: 2026-02-07

## 🎉 New Features

### macOS Dock Menu Integration
- **Custom Dock Menu**: Right-click app icon in Dock shows all open editor windows
  - Dynamic window list updated in real-time as editors open/close
  - Click any window title to bring it to front
  - Current active window marked with checkmark (✓)
  - "Show All Editor Windows" command to bring all editors forward at once
- **Window Menu Integration**: All editor windows appear in macOS menu bar Window menu
  - Auto-added when editor opens
  - Auto-removed when editor closes via delegate

### Cross-Platform Support
- **macOS**: Native NSWindow + WKWebView with full Dock integration
- **Windows**: Editor opens in default browser (Internet Explorer/Edge/Chrome)
- **Linux**: Editor opens in default browser via xdg-open (experimental)

### Technical Improvements
- **ObjC Runtime Injection**: `class_addMethod` dynamically adds `applicationDockMenu:` to Wails delegate
- **Memory Safety**: Fixed CGo use-after-free crash in async dispatch blocks
  - Synchronous NSString conversion before async operations
  - Proper strong references for all NSWindow instances
- **Clean Lifecycle Management**: EditorWindowDelegate handles window cleanup on close

## 📦 Download

### macOS (Apple Silicon / M1/M2/M3)
- **File**: `xterm-file-manager-darwin-arm64.zip` (4.2 MB)
- **Binary Size**: 11 MB (uncompressed)
- **Requirements**: macOS 11.0+ (Big Sur or later)

### macOS (Intel)
- **File**: `xterm-file-manager-darwin-amd64.zip` (4.5 MB)
- **Binary Size**: 11 MB (uncompressed)
- **Requirements**: macOS 10.15+ (Catalina or later)

### Windows (64-bit)
- **File**: `xterm-file-manager-windows-amd64.zip` (5.0 MB)
- **Executable**: `xterm-file-manager-windows-amd64.exe` (13 MB)
- **Requirements**: Windows 10/11 (WebView2 runtime required)

## 🚀 Installation

### macOS
1. Download the appropriate `.zip` file for your Mac (ARM64 for Apple Silicon, AMD64 for Intel)
2. Extract the ZIP file
3. **Remove quarantine attribute** (required for unsigned apps):
   ```bash
   xattr -cr xterm-file-manager-darwin-arm64.app
   # or
   xattr -cr xterm-file-manager-darwin-amd64.app
   ```
4. Drag to `/Applications` folder (recommended)
5. Double-click to launch

### Windows
1. Download `xterm-file-manager-windows-amd64.zip`
2. Extract the ZIP file
3. Run `xterm-file-manager-windows-amd64.exe`
4. If prompted by Windows Defender, click "More info" → "Run anyway"

## 🔧 Platform-Specific Notes

### macOS Features (Exclusive)
- ✅ Native NSWindow editor windows with full macOS integration
- ✅ Dock menu showing all open editor windows
- ✅ Window menu integration
- ✅ Mission Control and Spaces support
- ✅ Proper window minimize/maximize with native controls

### Windows/Linux Features
- ✅ Editor opens in default system browser
- ✅ All terminal and file management features work identically
- ⚠️ No Dock/Taskbar menu integration (browser windows are separate)
- ⚠️ Editor windows managed by browser, not by the app

## 📝 Technical Details

### Build Information
- **Wails Version**: 2.11.0
- **Go Version**: 1.21+
- **Build Mode**: Production (optimized)
- **Frontend**: React + Vite + TypeScript
- **Backend**: Go + Wails + CGo (macOS only)

### Architecture
```
macOS (ARM64/AMD64):
  - Native NSWindow + WKWebView
  - CGo bindings to Cocoa/WebKit frameworks
  - ObjC Runtime method injection

Windows (AMD64):
  - WebView2 (Chromium-based)
  - Browser fallback for editor windows
  - Go standard library only (no CGo)
```

### File Structure
- `internal/app/editor_window_darwin.go` - macOS native window implementation
- `internal/app/editor_window_stub.go` - Windows/Linux browser fallback
- `internal/app/editor_server.go` - HTTP server for editor content
- Build tags ensure correct platform-specific compilation

## 🐛 Known Issues

1. **Windows**: Editor opens in browser instead of native window (by design)
2. **macOS**: First launch may be slow due to signature verification
3. **All platforms**: Large files (>10MB) may load slowly in editor

## 🔗 Links

- **Repository**: https://github.com/xxddccaa/xterm-file-manager
- **Issues**: https://github.com/xxddccaa/xterm-file-manager/issues
- **Git Tag**: v2.24

## 📄 Checksums

```
xterm-file-manager-darwin-arm64.zip:  4.2 MB
xterm-file-manager-darwin-amd64.zip:  4.5 MB
xterm-file-manager-windows-amd64.zip: 5.0 MB
```

---

**Previous Versions**:
- v2.23 - Native Independent Editor Window (2026-02-06)
- v2.22 - File Editor Tab (2026-02-06)
- v2.21 - Project Structure Reorganization (2026-02-06)
