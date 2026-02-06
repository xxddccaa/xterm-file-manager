# XTerm File Manager (Go + Wails)

A modern, lightweight SSH terminal with integrated file manager. Built with Go (Wails) and React.

## Features

- **SSH Connection Management**: Automatically reads and parses `~/.ssh/config` file
- **Integrated File Manager**: SFTP file browser (coming soon)
- **Modern Terminal**: Based on xterm.js with full terminal emulation
- **Lightweight**: Built with Go + Wails, much lighter than Electron

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
