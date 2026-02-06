//go:build !darwin

package app

import (
	"log"
	"os/exec"
	"runtime"
)

// OpenNativeWindow opens the editor in the system's default browser on non-macOS platforms.
// macOS uses native NSWindow, but Windows/Linux use the browser for cross-platform compatibility.
func OpenNativeWindow(url string, title string, width int, height int) {
	go func() {
		var cmd *exec.Cmd
		switch runtime.GOOS {
		case "windows":
			cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
		case "linux":
			cmd = exec.Command("xdg-open", url)
		default:
			log.Printf("Unsupported platform for OpenNativeWindow: %s", runtime.GOOS)
			return
		}

		if err := cmd.Start(); err != nil {
			log.Printf("Failed to open browser: %v", err)
		}
	}()
}

// BringAllEditorWindowsToFront is a stub for non-macOS platforms.
func BringAllEditorWindowsToFront() {
	// No-op on non-Darwin platforms
}

// GetEditorWindowCount is a stub for non-macOS platforms.
func GetEditorWindowCount() int {
	return 0
}
