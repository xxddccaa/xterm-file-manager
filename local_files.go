package main

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/user"
	"path/filepath"
	"strings"
	"time"

	"github.com/pkg/sftp"
)

// LocalFileInfo represents a local file or directory
type LocalFileInfo struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	IsDir   bool   `json:"isDir"`
	Size    int64  `json:"size"`
	ModTime string `json:"modTime"`
}

// TransferProgress represents file transfer progress
type TransferProgress struct {
	FileName    string  `json:"fileName"`
	TotalBytes  int64   `json:"totalBytes"`
	Transferred int64   `json:"transferred"`
	Percent     float64 `json:"percent"`
	Status      string  `json:"status"` // "transferring", "completed", "error"
	Error       string  `json:"error,omitempty"`
}

// GetHomeDirectory returns the current user's home directory
func (a *App) GetHomeDirectory() (string, error) {
	usr, err := user.Current()
	if err != nil {
		return "", fmt.Errorf("failed to get current user: %v", err)
	}
	return usr.HomeDir, nil
}

// ListLocalFiles lists files in a local directory
func (a *App) ListLocalFiles(path string) ([]LocalFileInfo, error) {
	// Expand ~ to home directory
	if path == "~" || path == "" {
		homeDir, err := a.GetHomeDirectory()
		if err != nil {
			return nil, err
		}
		path = homeDir
	}

	// Clean the path
	path = filepath.Clean(path)

	// Read directory
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read directory: %v", err)
	}

	var files []LocalFileInfo
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		fullPath := filepath.Join(path, entry.Name())

		fileInfo := LocalFileInfo{
			Name:    entry.Name(),
			Path:    fullPath,
			IsDir:   entry.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime().Format(time.RFC3339),
		}
		files = append(files, fileInfo)
	}

	return files, nil
}

// getSFTPClient creates an SFTP client from an existing SSH session
func getSFTPClient(sessionID string) (*sftp.Client, error) {
	sshManager.mu.RLock()
	session, exists := sshManager.sessions[sessionID]
	sshManager.mu.RUnlock()

	if !exists {
		return nil, fmt.Errorf("session not found: %s", sessionID)
	}

	if !session.Connected || session.Client == nil {
		return nil, fmt.Errorf("session not connected")
	}

	sftpClient, err := sftp.NewClient(session.Client)
	if err != nil {
		return nil, fmt.Errorf("failed to create SFTP client: %v", err)
	}

	return sftpClient, nil
}

// resolveRemotePath resolves ~ in remote paths to the actual home directory via SFTP
func resolveRemotePath(sftpClient *sftp.Client, remotePath string) string {
	if strings.HasPrefix(remotePath, "~/") {
		// Get remote home directory via SFTP (Getwd returns home dir for SFTP)
		homeDir, err := sftpClient.Getwd()
		if err == nil {
			remotePath = homeDir + remotePath[1:]
		}
	} else if remotePath == "~" {
		homeDir, err := sftpClient.Getwd()
		if err == nil {
			remotePath = homeDir
		}
	}
	return remotePath
}

// GetRemoteHomeDir returns the remote user's home directory
func (a *App) GetRemoteHomeDir(sessionID string) (string, error) {
	sftpClient, err := getSFTPClient(sessionID)
	if err != nil {
		return "", err
	}
	defer sftpClient.Close()

	homeDir, err := sftpClient.Getwd()
	if err != nil {
		return "", fmt.Errorf("failed to get remote home directory: %v", err)
	}
	return homeDir, nil
}

// DownloadFile downloads a file from remote server to local path via SFTP
func (a *App) DownloadFile(sessionID string, remotePath string, localDir string) (string, error) {
	sftpClient, err := getSFTPClient(sessionID)
	if err != nil {
		return "", err
	}
	defer sftpClient.Close()

	// Resolve ~ to actual home directory
	remotePath = resolveRemotePath(sftpClient, remotePath)

	log.Printf("📥 Resolved remote path: %s", remotePath)

	// Open remote file
	remoteFile, err := sftpClient.Open(remotePath)
	if err != nil {
		return "", fmt.Errorf("failed to open remote file: %v", err)
	}
	defer remoteFile.Close()

	// Get remote file info
	remoteInfo, err := remoteFile.Stat()
	if err != nil {
		return "", fmt.Errorf("failed to stat remote file: %v", err)
	}

	// Determine local file path
	fileName := filepath.Base(remotePath)
	localPath := filepath.Join(localDir, fileName)

	log.Printf("📥 Downloading: %s -> %s (size: %d bytes)", remotePath, localPath, remoteInfo.Size())

	// Create local file
	localFile, err := os.Create(localPath)
	if err != nil {
		return "", fmt.Errorf("failed to create local file: %v", err)
	}
	defer localFile.Close()

	// Copy data
	written, err := io.Copy(localFile, remoteFile)
	if err != nil {
		os.Remove(localPath) // cleanup on error
		return "", fmt.Errorf("failed to download file: %v", err)
	}

	log.Printf("✅ Download complete: %s (%d bytes)", localPath, written)
	return localPath, nil
}

// UploadFile uploads a local file to remote server via SFTP
func (a *App) UploadFile(sessionID string, localPath string, remoteDir string) (string, error) {
	sftpClient, err := getSFTPClient(sessionID)
	if err != nil {
		return "", err
	}
	defer sftpClient.Close()

	// Resolve ~ to actual home directory
	remoteDir = resolveRemotePath(sftpClient, remoteDir)

	log.Printf("📤 Resolved remote dir: %s", remoteDir)

	// Open local file
	localFile, err := os.Open(localPath)
	if err != nil {
		return "", fmt.Errorf("failed to open local file: %v", err)
	}
	defer localFile.Close()

	// Get local file info
	localInfo, err := localFile.Stat()
	if err != nil {
		return "", fmt.Errorf("failed to stat local file: %v", err)
	}

	// Determine remote file path
	fileName := filepath.Base(localPath)
	remotePath := remoteDir + "/" + fileName

	log.Printf("📤 Uploading: %s -> %s (size: %d bytes)", localPath, remotePath, localInfo.Size())

	// Create remote file
	remoteFile, err := sftpClient.Create(remotePath)
	if err != nil {
		return "", fmt.Errorf("failed to create remote file: %v", err)
	}
	defer remoteFile.Close()

	// Copy data
	written, err := io.Copy(remoteFile, localFile)
	if err != nil {
		sftpClient.Remove(remotePath) // cleanup on error
		return "", fmt.Errorf("failed to upload file: %v", err)
	}

	log.Printf("✅ Upload complete: %s (%d bytes)", remotePath, written)
	return remotePath, nil
}

// DownloadDirectory recursively downloads a directory from remote to local
func (a *App) DownloadDirectory(sessionID string, remotePath string, localDir string) error {
	sftpClient, err := getSFTPClient(sessionID)
	if err != nil {
		return err
	}
	defer sftpClient.Close()

	// Resolve ~ to actual home directory
	remotePath = resolveRemotePath(sftpClient, remotePath)

	// Get remote dir name
	dirName := filepath.Base(remotePath)
	localPath := filepath.Join(localDir, dirName)

	// Create local directory
	if err := os.MkdirAll(localPath, 0755); err != nil {
		return fmt.Errorf("failed to create local directory: %v", err)
	}

	// Walk remote directory
	walker := sftpClient.Walk(remotePath)
	for walker.Step() {
		if err := walker.Err(); err != nil {
			log.Printf("⚠️ Walk error: %v", err)
			continue
		}

		relPath, err := filepath.Rel(remotePath, walker.Path())
		if err != nil {
			continue
		}

		targetPath := filepath.Join(localPath, relPath)

		if walker.Stat().IsDir() {
			os.MkdirAll(targetPath, 0755)
		} else {
			// Download individual file
			remoteFile, err := sftpClient.Open(walker.Path())
			if err != nil {
				log.Printf("⚠️ Skip file %s: %v", walker.Path(), err)
				continue
			}

			localFile, err := os.Create(targetPath)
			if err != nil {
				remoteFile.Close()
				log.Printf("⚠️ Skip file %s: %v", targetPath, err)
				continue
			}

			io.Copy(localFile, remoteFile)
			localFile.Close()
			remoteFile.Close()
		}
	}

	return nil
}

// DeleteRemoteFile deletes a remote file via SFTP
func (a *App) DeleteRemoteFile(sessionID string, remotePath string) error {
	sftpClient, err := getSFTPClient(sessionID)
	if err != nil {
		return err
	}
	defer sftpClient.Close()

	// Resolve ~ to actual home directory
	remotePath = resolveRemotePath(sftpClient, remotePath)

	log.Printf("🗑️ Deleting remote file: %s", remotePath)

	// Check if it's a directory
	info, err := sftpClient.Stat(remotePath)
	if err != nil {
		return fmt.Errorf("failed to stat remote path: %v", err)
	}

	if info.IsDir() {
		return fmt.Errorf("path is a directory, use DeleteRemoteDirectory instead")
	}

	// Delete file
	if err := sftpClient.Remove(remotePath); err != nil {
		return fmt.Errorf("failed to delete remote file: %v", err)
	}

	log.Printf("✅ Deleted remote file: %s", remotePath)
	return nil
}

// DeleteRemoteDirectory recursively deletes a remote directory via SFTP
func (a *App) DeleteRemoteDirectory(sessionID string, remotePath string) error {
	sftpClient, err := getSFTPClient(sessionID)
	if err != nil {
		return err
	}
	defer sftpClient.Close()

	// Resolve ~ to actual home directory
	remotePath = resolveRemotePath(sftpClient, remotePath)

	log.Printf("🗑️ Deleting remote directory: %s", remotePath)

	// Walk the directory and delete all files first
	walker := sftpClient.Walk(remotePath)
	var filesToDelete []string
	var dirsToDelete []string

	for walker.Step() {
		if err := walker.Err(); err != nil {
			log.Printf("⚠️ Walk error: %v", err)
			continue
		}

		path := walker.Path()
		if path == remotePath {
			continue // Skip root directory
		}

		if walker.Stat().IsDir() {
			dirsToDelete = append([]string{path}, dirsToDelete...) // Prepend to delete deepest first
		} else {
			filesToDelete = append(filesToDelete, path)
		}
	}

	// Delete all files
	for _, filePath := range filesToDelete {
		if err := sftpClient.Remove(filePath); err != nil {
			log.Printf("⚠️ Failed to delete file %s: %v", filePath, err)
		}
	}

	// Delete all directories (deepest first)
	for _, dirPath := range dirsToDelete {
		if err := sftpClient.RemoveDirectory(dirPath); err != nil {
			log.Printf("⚠️ Failed to delete directory %s: %v", dirPath, err)
		}
	}

	// Finally delete the root directory
	if err := sftpClient.RemoveDirectory(remotePath); err != nil {
		return fmt.Errorf("failed to delete remote directory: %v", err)
	}

	log.Printf("✅ Deleted remote directory: %s", remotePath)
	return nil
}

// DeleteLocalFile deletes a local file
func (a *App) DeleteLocalFile(localPath string) error {
	log.Printf("🗑️ Deleting local file: %s", localPath)

	// Check if it's a directory
	info, err := os.Stat(localPath)
	if err != nil {
		return fmt.Errorf("failed to stat local path: %v", err)
	}

	if info.IsDir() {
		return fmt.Errorf("path is a directory, use DeleteLocalDirectory instead")
	}

	// Delete file
	if err := os.Remove(localPath); err != nil {
		return fmt.Errorf("failed to delete local file: %v", err)
	}

	log.Printf("✅ Deleted local file: %s", localPath)
	return nil
}

// DeleteLocalDirectory recursively deletes a local directory
func (a *App) DeleteLocalDirectory(localPath string) error {
	log.Printf("🗑️ Deleting local directory: %s", localPath)

	// Use RemoveAll to recursively delete directory and all contents
	if err := os.RemoveAll(localPath); err != nil {
		return fmt.Errorf("failed to delete local directory: %v", err)
	}

	log.Printf("✅ Deleted local directory: %s", localPath)
	return nil
}
