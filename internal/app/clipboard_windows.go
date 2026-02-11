//go:build windows

package app

import (
	"fmt"
	"log"
	"os/exec"
	"strings"
)

// copyLocalFilesToSystemClipboard writes local file paths to the Windows system clipboard.
// Uses PowerShell's Set-Clipboard with -Path parameter to set file references,
// making files available for paste in Explorer, WeChat, Feishu, etc.
func copyLocalFilesToSystemClipboard(paths []string) error {
	if len(paths) == 0 {
		return fmt.Errorf("no files to copy")
	}

	// Build PowerShell command: Set-Clipboard -Path "path1","path2",...
	// This sets CF_HDROP (file drop) format on the clipboard.
	quotedPaths := make([]string, len(paths))
	for i, p := range paths {
		// Escape single quotes in paths for PowerShell
		escaped := strings.ReplaceAll(p, "'", "''")
		quotedPaths[i] = "'" + escaped + "'"
	}
	pathArg := strings.Join(quotedPaths, ",")
	psCmd := fmt.Sprintf("Set-Clipboard -Path %s", pathArg)

	log.Printf("📋 [Windows] Copying files to clipboard via PowerShell: %s", psCmd)

	cmd := exec.Command("powershell", "-NoProfile", "-NonInteractive", "-Command", psCmd)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to copy files to clipboard: %v (output: %s)", err, string(output))
	}

	return nil
}
