//go:build !darwin && !windows

package app

import "fmt"

// copyLocalFilesToSystemClipboard is a stub for unsupported platforms (Linux, etc.).
// System clipboard file operations require platform-specific implementations.
func copyLocalFilesToSystemClipboard(paths []string) error {
	return fmt.Errorf("copy files to system clipboard is not supported on this platform")
}
