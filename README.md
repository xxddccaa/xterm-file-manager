# XTerm File Manager (Go + Wails)

A modern, lightweight SSH terminal with integrated file manager. Built with Go (Wails) and React.

## Features

- **SSH Connection Management**: Automatically reads and parses `~/.ssh/config` file
- **Integrated File Manager**: SFTP file browser (coming soon)
- **Modern Terminal**: Based on xterm.js with full terminal emulation
- **Lightweight**: Built with Go + Wails, much lighter than Electron

## Installation

### macOS (Apple Silicon / M1/M2/M3)

1. Download `xterm-file-manager-darwin-arm64.zip` from [Releases](https://github.com/xxddccaa/xterm-file-manager/releases)
2. Extract the ZIP file
3. You'll get `xterm-file-manager-darwin-arm64.app`

**Important - Fix "App is damaged" error:**

If you see "xterm-file-manager-darwin-arm64 is damaged and can't be opened", this is macOS Gatekeeper blocking unsigned apps. Fix it by running in Terminal:

```bash
# Remove quarantine attribute
xattr -cr xterm-file-manager-darwin-arm64.app

# Then open the app
open xterm-file-manager-darwin-arm64.app
```

Or manually:
1. Right-click the `.app` file
2. Select "Open"
3. Click "Open" in the security dialog

4. Drag the app to your Applications folder (optional)

### macOS (Intel)

1. Download `xterm-file-manager-darwin-amd64.zip` from [Releases](https://github.com/xxddccaa/xterm-file-manager/releases)
2. Extract the ZIP file to get `xterm-file-manager-darwin-amd64.app`
3. **If you see "App is damaged" error**, run in Terminal:
   ```bash
   xattr -cr xterm-file-manager-darwin-amd64.app
   open xterm-file-manager-darwin-amd64.app
   ```

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
cd frontend
npm install
cd ..

# Run in development mode
wails dev
```

### Build

```bash
# Build for current platform
wails build

# Build for specific platform
wails build -platform darwin/amd64
wails build -platform windows/amd64
wails build -platform linux/amd64
```

## Project Structure

```
xterm-file-manager/
├── main.go          # Application entry point
├── app.go           # App struct and lifecycle
├── ssh.go           # SSH config parser
├── frontend/        # React frontend
│   ├── src/
│   └── package.json
└── go.mod
```

## License

MIT
