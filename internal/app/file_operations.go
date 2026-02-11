package app

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// expandHome expands ~ in paths to the user's home directory
func expandHome(path string) (string, error) {
	if path == "~" {
		return os.UserHomeDir()
	}
	if strings.HasPrefix(path, "~/") {
		homeDir, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("failed to get home directory: %v", err)
		}
		return filepath.Join(homeDir, path[2:]), nil
	}
	return path, nil
}

// CopyLocalFile copies a file from src to dst
func (a *App) CopyLocalFile(src string, dst string) error {
	src, err := expandHome(src)
	if err != nil {
		return err
	}
	dst, err = expandHome(dst)
	if err != nil {
		return err
	}

	log.Printf("📋 Copying file: %s -> %s", src, dst)

	srcInfo, err := os.Stat(src)
	if err != nil {
		return fmt.Errorf("failed to stat source: %v", err)
	}
	if srcInfo.IsDir() {
		return fmt.Errorf("source is a directory, use CopyLocalDirectory instead")
	}

	// If dst is a directory, copy into it with the same filename
	dstInfo, err := os.Stat(dst)
	if err == nil && dstInfo.IsDir() {
		dst = filepath.Join(dst, filepath.Base(src))
	}

	// Create parent directory if needed
	if err := os.MkdirAll(filepath.Dir(dst), 0755); err != nil {
		return fmt.Errorf("failed to create destination directory: %v", err)
	}

	// Open source
	srcFile, err := os.Open(src)
	if err != nil {
		return fmt.Errorf("failed to open source file: %v", err)
	}
	defer srcFile.Close()

	// Create destination
	dstFile, err := os.Create(dst)
	if err != nil {
		return fmt.Errorf("failed to create destination file: %v", err)
	}
	defer dstFile.Close()

	// Copy data
	if _, err := io.Copy(dstFile, srcFile); err != nil {
		return fmt.Errorf("failed to copy file: %v", err)
	}

	// Preserve file mode
	if err := os.Chmod(dst, srcInfo.Mode()); err != nil {
		log.Printf("⚠️ Failed to preserve file mode: %v", err)
	}

	log.Printf("✅ Copied file: %s -> %s", src, dst)
	return nil
}

// CopyLocalDirectory recursively copies a directory from src to dst
func (a *App) CopyLocalDirectory(src string, dst string) error {
	src, err := expandHome(src)
	if err != nil {
		return err
	}
	dst, err = expandHome(dst)
	if err != nil {
		return err
	}

	log.Printf("📋 Copying directory: %s -> %s", src, dst)

	srcInfo, err := os.Stat(src)
	if err != nil {
		return fmt.Errorf("failed to stat source: %v", err)
	}
	if !srcInfo.IsDir() {
		return fmt.Errorf("source is not a directory")
	}

	// If dst exists and is a directory, copy into it
	dstInfo, err := os.Stat(dst)
	if err == nil && dstInfo.IsDir() {
		dst = filepath.Join(dst, filepath.Base(src))
	}

	// Walk source directory
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}

		// Calculate relative path
		relPath, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}

		targetPath := filepath.Join(dst, relPath)

		if info.IsDir() {
			return os.MkdirAll(targetPath, info.Mode())
		}

		// Copy file
		srcFile, err := os.Open(path)
		if err != nil {
			return fmt.Errorf("failed to open %s: %v", path, err)
		}
		defer srcFile.Close()

		dstFile, err := os.Create(targetPath)
		if err != nil {
			return fmt.Errorf("failed to create %s: %v", targetPath, err)
		}
		defer dstFile.Close()

		if _, err := io.Copy(dstFile, srcFile); err != nil {
			return fmt.Errorf("failed to copy %s: %v", path, err)
		}

		return os.Chmod(targetPath, info.Mode())
	})
}

// CreateLocalDirectory creates a new directory (and parent directories if needed)
func (a *App) CreateLocalDirectory(dirPath string) error {
	dirPath, err := expandHome(dirPath)
	if err != nil {
		return err
	}

	log.Printf("📁 Creating directory: %s", dirPath)

	if err := os.MkdirAll(dirPath, 0755); err != nil {
		return fmt.Errorf("failed to create directory: %v", err)
	}

	log.Printf("✅ Created directory: %s", dirPath)
	return nil
}

// MoveLocalFile moves a file or directory from src to dst
func (a *App) MoveLocalFile(src string, dst string) error {
	src, err := expandHome(src)
	if err != nil {
		return err
	}
	dst, err = expandHome(dst)
	if err != nil {
		return err
	}

	log.Printf("📦 Moving: %s -> %s", src, dst)

	// If dst is a directory, move into it
	dstInfo, err := os.Stat(dst)
	if err == nil && dstInfo.IsDir() {
		dst = filepath.Join(dst, filepath.Base(src))
	}

	// Try os.Rename first (fast, same filesystem)
	if err := os.Rename(src, dst); err != nil {
		// If rename fails (cross-device), fall back to copy + delete
		srcInfo, statErr := os.Stat(src)
		if statErr != nil {
			return fmt.Errorf("failed to stat source: %v", statErr)
		}

		if srcInfo.IsDir() {
			if copyErr := a.CopyLocalDirectory(src, dst); copyErr != nil {
				return fmt.Errorf("failed to copy directory: %v", copyErr)
			}
			if removeErr := os.RemoveAll(src); removeErr != nil {
				return fmt.Errorf("copied but failed to remove source: %v", removeErr)
			}
		} else {
			if copyErr := a.CopyLocalFile(src, dst); copyErr != nil {
				return fmt.Errorf("failed to copy file: %v", copyErr)
			}
			if removeErr := os.Remove(src); removeErr != nil {
				return fmt.Errorf("copied but failed to remove source: %v", removeErr)
			}
		}
	}

	log.Printf("✅ Moved: %s -> %s", src, dst)
	return nil
}

// IsDirectory checks if the given path is a directory
func (a *App) IsDirectory(path string) (bool, error) {
	path, err := expandHome(path)
	if err != nil {
		return false, err
	}

	info, err := os.Stat(path)
	if err != nil {
		return false, fmt.Errorf("failed to stat path: %v", err)
	}

	return info.IsDir(), nil
}

// GetParentDirectory returns the parent directory of the given path
func (a *App) GetParentDirectory(path string) (string, error) {
	path, err := expandHome(path)
	if err != nil {
		return "", err
	}

	return filepath.Dir(path), nil
}

// ── Clipboard Management ────────────────────────────────────────────────────

// ClipboardData holds file paths and the operation type
type ClipboardData struct {
	Files     []string `json:"files"`
	Operation string   `json:"operation"` // "copy" or "cut"
}

var (
	fileClipboard *ClipboardData
	clipboardMu   sync.RWMutex
)

// SetFileClipboard stores files and operation in the clipboard
func (a *App) SetFileClipboard(files []string, operation string) error {
	if operation != "copy" && operation != "cut" {
		return fmt.Errorf("invalid operation: %s (must be 'copy' or 'cut')", operation)
	}

	clipboardMu.Lock()
	defer clipboardMu.Unlock()

	fileClipboard = &ClipboardData{
		Files:     files,
		Operation: operation,
	}

	log.Printf("📋 Clipboard set: %s %d files", operation, len(files))
	return nil
}

// GetFileClipboard returns the current clipboard contents
func (a *App) GetFileClipboard() *ClipboardData {
	clipboardMu.RLock()
	defer clipboardMu.RUnlock()

	if fileClipboard == nil {
		return &ClipboardData{Files: []string{}, Operation: ""}
	}

	return fileClipboard
}

// PasteFiles pastes clipboard files into the target directory
func (a *App) PasteFiles(targetDir string) error {
	clipboardMu.Lock()
	clipboard := fileClipboard
	clipboardMu.Unlock()

	if clipboard == nil || len(clipboard.Files) == 0 {
		return fmt.Errorf("clipboard is empty")
	}

	targetDir, err := expandHome(targetDir)
	if err != nil {
		return err
	}

	log.Printf("📋 Pasting %d files to %s (operation: %s)", len(clipboard.Files), targetDir, clipboard.Operation)

	for _, srcPath := range clipboard.Files {
		srcPath, err := expandHome(srcPath)
		if err != nil {
			log.Printf("⚠️ Failed to expand path %s: %v", srcPath, err)
			continue
		}

		srcInfo, err := os.Stat(srcPath)
		if err != nil {
			log.Printf("⚠️ Failed to stat %s: %v", srcPath, err)
			continue
		}

		dstPath := filepath.Join(targetDir, filepath.Base(srcPath))

		// Handle name conflict: append (copy) suffix
		if _, err := os.Stat(dstPath); err == nil {
			dstPath = generateUniquePath(dstPath)
		}

		if clipboard.Operation == "copy" {
			if srcInfo.IsDir() {
				if err := a.CopyLocalDirectory(srcPath, dstPath); err != nil {
					return fmt.Errorf("failed to copy directory %s: %v", srcPath, err)
				}
			} else {
				if err := a.CopyLocalFile(srcPath, dstPath); err != nil {
					return fmt.Errorf("failed to copy file %s: %v", srcPath, err)
				}
			}
		} else if clipboard.Operation == "cut" {
			if err := a.MoveLocalFile(srcPath, dstPath); err != nil {
				return fmt.Errorf("failed to move %s: %v", srcPath, err)
			}
		}
	}

	// Clear clipboard after cut operation
	if clipboard.Operation == "cut" {
		clipboardMu.Lock()
		fileClipboard = nil
		clipboardMu.Unlock()
	}

	log.Printf("✅ Paste complete")
	return nil
}

// ── System Clipboard (OS-level) ──────────────────────────────────────────────
// These methods write file references to the OS pasteboard (NSPasteboard / CF_HDROP)
// so the user can paste files into external apps like Finder, Feishu, WeChat, etc.

// CopyFilesToSystemClipboard copies local file paths to the system clipboard.
// After this call, the user can Cmd+V (macOS) or Ctrl+V (Windows) paste files
// into Finder, Feishu, WeChat, Slack, and any app that accepts file pastes.
func (a *App) CopyFilesToSystemClipboard(paths []string) error {
	if len(paths) == 0 {
		return fmt.Errorf("no files to copy")
	}

	// Expand ~ in paths
	expandedPaths := make([]string, 0, len(paths))
	for _, p := range paths {
		ep, err := expandHome(p)
		if err != nil {
			log.Printf("⚠️ Failed to expand path %s: %v", p, err)
			continue
		}
		// Verify file exists
		if _, err := os.Stat(ep); err != nil {
			log.Printf("⚠️ File not found: %s", ep)
			continue
		}
		expandedPaths = append(expandedPaths, ep)
	}

	if len(expandedPaths) == 0 {
		return fmt.Errorf("no valid files to copy")
	}

	log.Printf("📋 Copying %d file(s) to system clipboard: %v", len(expandedPaths), expandedPaths)

	if err := copyLocalFilesToSystemClipboard(expandedPaths); err != nil {
		return fmt.Errorf("failed to copy to system clipboard: %v", err)
	}

	log.Printf("✅ Files copied to system clipboard")
	return nil
}

// CopyRemoteFilesToSystemClipboard downloads remote files/directories to a temp
// directory, then copies them to the system clipboard for pasting into external apps.
// This is a two-step operation: SFTP download + OS clipboard write.
// Supports both files and directories — directories are recursively downloaded.
func (a *App) CopyRemoteFilesToSystemClipboard(sessionID string, remotePaths []string) error {
	if len(remotePaths) == 0 {
		return fmt.Errorf("no files to copy")
	}

	// Get SFTP client to check remote path types (file vs directory)
	sftpClient, err := getSFTPClient(sessionID)
	if err != nil {
		return fmt.Errorf("failed to get SFTP client: %v", err)
	}

	// Create a temp directory for staging remote files
	tempDir, err := os.MkdirTemp("", "xterm-fm-clipboard-*")
	if err != nil {
		return fmt.Errorf("failed to create temp directory: %v", err)
	}

	// Track temp dir for later cleanup
	trackTempDir(tempDir)

	log.Printf("📋 Downloading %d remote item(s) to temp dir for clipboard: %s", len(remotePaths), tempDir)

	localPaths := make([]string, 0, len(remotePaths))
	for _, remotePath := range remotePaths {
		// Resolve ~ in remote path
		resolved := resolveRemotePath(sftpClient, remotePath)

		// Check if remote path is a file or directory
		info, err := sftpClient.Stat(resolved)
		if err != nil {
			log.Printf("⚠️ Failed to stat remote path %s: %v", remotePath, err)
			continue
		}

		if info.IsDir() {
			// Directory: use DownloadDirectory for recursive download
			if err := a.DownloadDirectory(sessionID, remotePath, tempDir); err != nil {
				log.Printf("⚠️ Failed to download directory %s: %v", remotePath, err)
				continue
			}
			// DownloadDirectory creates tempDir/<dirname>, build the local path
			localPaths = append(localPaths, filepath.Join(tempDir, filepath.Base(resolved)))
		} else {
			// File: use DownloadFile
			localPath, err := a.DownloadFile(sessionID, remotePath, tempDir)
			if err != nil {
				log.Printf("⚠️ Failed to download file %s: %v", remotePath, err)
				continue
			}
			localPaths = append(localPaths, localPath)
		}
	}

	if len(localPaths) == 0 {
		os.RemoveAll(tempDir)
		return fmt.Errorf("failed to download any files")
	}

	// Copy the downloaded files/directories to system clipboard
	if err := copyLocalFilesToSystemClipboard(localPaths); err != nil {
		return fmt.Errorf("failed to copy to system clipboard: %v", err)
	}

	log.Printf("✅ Remote items copied to system clipboard (%d items)", len(localPaths))
	return nil
}

// ── Temp Directory Cleanup ───────────────────────────────────────────────────

var (
	tempDirs   []string
	tempDirsMu sync.Mutex
)

// trackTempDir records a temp directory for later cleanup
func trackTempDir(dir string) {
	tempDirsMu.Lock()
	defer tempDirsMu.Unlock()
	tempDirs = append(tempDirs, dir)
}

// CleanupTempDirs removes all tracked temp directories.
// Called on app shutdown or periodically.
func CleanupTempDirs() {
	tempDirsMu.Lock()
	dirs := make([]string, len(tempDirs))
	copy(dirs, tempDirs)
	tempDirs = nil
	tempDirsMu.Unlock()

	for _, dir := range dirs {
		if err := os.RemoveAll(dir); err != nil {
			log.Printf("⚠️ Failed to clean temp dir %s: %v", dir, err)
		} else {
			log.Printf("🧹 Cleaned temp dir: %s", dir)
		}
	}
}

// generateUniquePath appends " (copy)", " (copy 2)", etc. to avoid name conflicts
func generateUniquePath(path string) string {
	dir := filepath.Dir(path)
	base := filepath.Base(path)
	ext := filepath.Ext(base)
	name := strings.TrimSuffix(base, ext)

	for i := 1; i < 1000; i++ {
		var newName string
		if i == 1 {
			newName = fmt.Sprintf("%s (copy)%s", name, ext)
		} else {
			newName = fmt.Sprintf("%s (copy %d)%s", name, i, ext)
		}
		newPath := filepath.Join(dir, newName)
		if _, err := os.Stat(newPath); os.IsNotExist(err) {
			return newPath
		}
	}

	// Fallback: use timestamp
	return filepath.Join(dir, fmt.Sprintf("%s_%d%s", name, os.Getpid(), ext))
}
