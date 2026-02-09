package app

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"
	"github.com/pkg/sftp"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"golang.org/x/crypto/ssh"
)

// Sync-related constants
const (
	SyncDebounceDelay    = 500 * time.Millisecond
	RemotePollInterval   = 5 * time.Second
	InotifywaitBatchWait = 300 * time.Millisecond
	// SyncCooldown prevents local watcher from re-triggering a sync
	// immediately after a sync operation wrote files locally.
	SyncCooldown = 2 * time.Second
)

// SyncStatus represents the current state of a sync rule
type SyncStatus string

const (
	SyncStatusIdle    SyncStatus = "idle"
	SyncStatusSyncing SyncStatus = "syncing"
	SyncStatusSynced  SyncStatus = "synced"
	SyncStatusError   SyncStatus = "error"
)

// SyncRule represents a directory sync rule configuration
type SyncRule struct {
	ID         string `json:"id"`
	ServerName string `json:"serverName"`
	SSHHost    string `json:"sshHost"`
	RemotePath string `json:"remotePath"`
	LocalPath  string `json:"localPath"`
	Source     string `json:"source"` // "local" or "remote"
	Active     bool   `json:"active"`
	Status     string `json:"status"`
	LastSync   string `json:"lastSync"`
	Error      string `json:"error"`
}

// RemoteDepsStatus reports which sync dependencies are available on a remote server
type RemoteDepsStatus struct {
	HasRsync     bool   `json:"hasRsync"`
	HasInotify   bool   `json:"hasInotify"`
	RsyncVersion string `json:"rsyncVersion"`
	Message      string `json:"message"`
}

// SyncLogEntry represents a single sync log entry
type SyncLogEntry struct {
	RuleID    string `json:"ruleId"`
	Timestamp string `json:"timestamp"`
	Action    string `json:"action"` // "upload" | "download" | "delete" | "error" | "info"
	FilePath  string `json:"filePath"`
	Direction string `json:"direction"` // "local->remote" | "remote->local"
	Status    string `json:"status"`    // "success" | "error" | "info"
	Message   string `json:"message"`
}

// SyncStatusEvent represents a sync status change event
type SyncStatusEvent struct {
	RuleID string `json:"ruleId"`
	Status string `json:"status"`
	Detail string `json:"detail"`
	Error  string `json:"error"`
}

// syncRuleState holds the runtime state for an active sync rule
type syncRuleState struct {
	rule          *SyncRule
	sessionID     string
	cancel        context.CancelFunc
	watcher       *fsnotify.Watcher
	remoteSession *ssh.Session
	hasRsync      bool
	hasInotify    bool
	debounceTimer *time.Timer
	mu            sync.Mutex
	// syncing prevents re-entrant sync triggers (e.g. local watcher fires
	// because rsync just wrote files locally during a remote->local sync).
	syncing bool
	// Remote file snapshot for polling fallback
	remoteSnapshot map[string]fileSnapshot
}

// fileSnapshot stores file metadata for comparison
type fileSnapshot struct {
	Size    int64
	ModTime time.Time
	IsDir   bool
}

// SyncManager manages all sync rules and their runtime state
type SyncManager struct {
	rules  map[string]*SyncRule
	states map[string]*syncRuleState
	mu     sync.RWMutex
	app    *App
	ctx    context.Context
}

// Global sync manager instance
var syncMgr *SyncManager

// initSyncManager initializes the global sync manager
func initSyncManager(app *App, ctx context.Context) {
	syncMgr = &SyncManager{
		rules:  make(map[string]*SyncRule),
		states: make(map[string]*syncRuleState),
		app:    app,
		ctx:    ctx,
	}
	syncMgr.loadRules()
}

// --- Persistence ---

// getSyncConfigPath returns the path to the sync rules config file
func getSyncConfigPath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("failed to get user config dir: %v", err)
	}
	appConfigDir := filepath.Join(configDir, "xterm-file-manager")
	if err := os.MkdirAll(appConfigDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create config directory: %v", err)
	}
	return filepath.Join(appConfigDir, "sync-rules.json"), nil
}

func (sm *SyncManager) loadRules() {
	configPath, err := getSyncConfigPath()
	if err != nil {
		log.Printf("⚠️ [Sync] Failed to get config path: %v", err)
		return
	}

	data, err := os.ReadFile(configPath)
	if err != nil {
		if os.IsNotExist(err) {
			return
		}
		log.Printf("⚠️ [Sync] Failed to read sync config: %v", err)
		return
	}

	var rules []*SyncRule
	if err := json.Unmarshal(data, &rules); err != nil {
		log.Printf("⚠️ [Sync] Failed to parse sync config: %v", err)
		return
	}

	sm.mu.Lock()
	defer sm.mu.Unlock()
	for _, rule := range rules {
		rule.Active = false
		rule.Status = string(SyncStatusIdle)
		rule.Error = ""
		sm.rules[rule.ID] = rule
	}
	log.Printf("📂 [Sync] Loaded %d sync rules", len(rules))
}

func (sm *SyncManager) saveRules() {
	configPath, err := getSyncConfigPath()
	if err != nil {
		log.Printf("⚠️ [Sync] Failed to get config path: %v", err)
		return
	}

	sm.mu.RLock()
	rules := make([]*SyncRule, 0, len(sm.rules))
	for _, rule := range sm.rules {
		rules = append(rules, rule)
	}
	sm.mu.RUnlock()

	data, err := json.MarshalIndent(rules, "", "  ")
	if err != nil {
		log.Printf("⚠️ [Sync] Failed to marshal sync config: %v", err)
		return
	}

	if err := os.WriteFile(configPath, data, 0644); err != nil {
		log.Printf("⚠️ [Sync] Failed to write sync config: %v", err)
	}
}

// --- Event helpers ---

func (sm *SyncManager) emitLog(entry SyncLogEntry) {
	if entry.Timestamp == "" {
		entry.Timestamp = time.Now().Format(time.RFC3339)
	}
	if sm.app != nil && sm.app.ctx != nil {
		runtime.EventsEmit(sm.app.ctx, "sync:log", entry)
	}
	log.Printf("📋 [Sync] %s %s %s %s", entry.Action, entry.FilePath, entry.Direction, entry.Message)
}

func (sm *SyncManager) emitStatus(event SyncStatusEvent) {
	if sm.app != nil && sm.app.ctx != nil {
		runtime.EventsEmit(sm.app.ctx, "sync:status", event)
	}
}

func (sm *SyncManager) updateRuleStatus(ruleID string, status SyncStatus, detail string, errMsg string) {
	sm.mu.Lock()
	if rule, ok := sm.rules[ruleID]; ok {
		rule.Status = string(status)
		rule.Error = errMsg
		if status == SyncStatusSynced {
			rule.LastSync = time.Now().Format(time.RFC3339)
		}
	}
	sm.mu.Unlock()

	sm.emitStatus(SyncStatusEvent{
		RuleID: ruleID,
		Status: string(status),
		Detail: detail,
		Error:  errMsg,
	})
}

// --- Wails-exposed App methods ---

// GetSyncRules returns all configured sync rules
func (a *App) GetSyncRules() []*SyncRule {
	if syncMgr == nil {
		return []*SyncRule{}
	}
	syncMgr.mu.RLock()
	defer syncMgr.mu.RUnlock()

	rules := make([]*SyncRule, 0, len(syncMgr.rules))
	for _, rule := range syncMgr.rules {
		rules = append(rules, rule)
	}
	return rules
}

// AddSyncRule adds a new sync rule
func (a *App) AddSyncRule(rule SyncRule) (*SyncRule, error) {
	if syncMgr == nil {
		return nil, fmt.Errorf("sync manager not initialized")
	}
	if rule.SSHHost == "" {
		return nil, fmt.Errorf("SSH host is required")
	}
	if rule.RemotePath == "" {
		return nil, fmt.Errorf("remote path is required")
	}
	if rule.LocalPath == "" {
		return nil, fmt.Errorf("local path is required")
	}
	if rule.Source != "local" && rule.Source != "remote" {
		rule.Source = "local"
	}

	rule.ID = fmt.Sprintf("sync-%d", time.Now().UnixNano())
	rule.Active = false
	rule.Status = string(SyncStatusIdle)

	syncMgr.mu.Lock()
	syncMgr.rules[rule.ID] = &rule
	syncMgr.mu.Unlock()

	syncMgr.saveRules()

	log.Printf("➕ [Sync] Added rule: %s (%s <-> %s:%s)", rule.ID, rule.LocalPath, rule.SSHHost, rule.RemotePath)
	return &rule, nil
}

// UpdateSyncRule updates an existing sync rule
func (a *App) UpdateSyncRule(rule SyncRule) error {
	if syncMgr == nil {
		return fmt.Errorf("sync manager not initialized")
	}

	syncMgr.mu.Lock()
	existing, ok := syncMgr.rules[rule.ID]
	if !ok {
		syncMgr.mu.Unlock()
		return fmt.Errorf("sync rule not found: %s", rule.ID)
	}
	wasActive := existing.Active
	syncMgr.mu.Unlock()

	if wasActive {
		a.StopSync(rule.ID)
	}

	syncMgr.mu.Lock()
	rule.Status = string(SyncStatusIdle)
	rule.Active = false
	syncMgr.rules[rule.ID] = &rule
	syncMgr.mu.Unlock()

	syncMgr.saveRules()
	return nil
}

// RemoveSyncRule removes a sync rule
func (a *App) RemoveSyncRule(ruleID string) error {
	if syncMgr == nil {
		return fmt.Errorf("sync manager not initialized")
	}

	a.StopSync(ruleID)

	syncMgr.mu.Lock()
	delete(syncMgr.rules, ruleID)
	syncMgr.mu.Unlock()

	syncMgr.saveRules()
	log.Printf("🗑️ [Sync] Removed rule: %s", ruleID)
	return nil
}

// SetSyncSource changes the source direction of a sync rule
func (a *App) SetSyncSource(ruleID string, source string) error {
	if syncMgr == nil {
		return fmt.Errorf("sync manager not initialized")
	}
	if source != "local" && source != "remote" {
		return fmt.Errorf("source must be 'local' or 'remote'")
	}

	syncMgr.mu.Lock()
	rule, ok := syncMgr.rules[ruleID]
	if !ok {
		syncMgr.mu.Unlock()
		return fmt.Errorf("sync rule not found: %s", ruleID)
	}
	wasActive := rule.Active
	syncMgr.mu.Unlock()

	if wasActive {
		a.StopSync(ruleID)
	}

	syncMgr.mu.Lock()
	syncMgr.rules[ruleID].Source = source
	syncMgr.mu.Unlock()
	syncMgr.saveRules()

	if wasActive {
		return a.StartSync(ruleID)
	}
	return nil
}

// TestSyncConnection tests if an SSH server is reachable and connectable.
// It creates a temporary connection, runs a simple command, then closes it.
func (a *App) TestSyncConnection(sshHost string) error {
	// Find matching SSH config
	sshConfigs := GetSSHConfig()
	var targetConfig *SSHConfigEntry
	for i := range sshConfigs {
		if sshConfigs[i].Host == sshHost {
			targetConfig = &sshConfigs[i]
			break
		}
	}
	if targetConfig == nil {
		return fmt.Errorf("SSH host '%s' not found in config", sshHost)
	}

	// Try to establish SSH connection
	sessionID, err := a.ConnectSSH(*targetConfig)
	if err != nil {
		return fmt.Errorf("connection failed: %v", err)
	}

	// Run a simple test command
	output, err := a.ExecuteCommand(sessionID, "echo ok")
	if err != nil {
		// Clean up the session even if the command fails
		a.DisconnectSSH(sessionID)
		return fmt.Errorf("connection established but command execution failed: %v", err)
	}

	if strings.TrimSpace(output) != "ok" {
		a.DisconnectSSH(sessionID)
		return fmt.Errorf("unexpected command output: %s", output)
	}

	// Clean up: disconnect the temporary session
	a.DisconnectSSH(sessionID)

	log.Printf("✅ [Sync] Connection test successful for host: %s", sshHost)
	return nil
}

// CheckRemoteSyncDeps checks if rsync and inotifywait are available on the remote server
func (a *App) CheckRemoteSyncDeps(sessionID string) RemoteDepsStatus {
	result := RemoteDepsStatus{}

	output, err := a.ExecuteCommand(sessionID, "which rsync 2>/dev/null && rsync --version 2>/dev/null | head -1")
	if err == nil && strings.TrimSpace(output) != "" {
		result.HasRsync = true
		lines := strings.Split(strings.TrimSpace(output), "\n")
		if len(lines) > 1 {
			result.RsyncVersion = strings.TrimSpace(lines[len(lines)-1])
		}
	}

	output2, err := a.ExecuteCommand(sessionID, "which inotifywait 2>/dev/null")
	if err == nil && strings.TrimSpace(output2) != "" {
		result.HasInotify = true
	}

	var msgs []string
	if !result.HasRsync {
		msgs = append(msgs, "rsync not found (will use SFTP fallback)")
	}
	if !result.HasInotify {
		msgs = append(msgs, "inotifywait not found (will use polling)")
	}
	if len(msgs) == 0 {
		result.Message = "All dependencies available"
	} else {
		result.Message = strings.Join(msgs, "; ")
	}

	return result
}

// StartSync starts syncing for a rule
func (a *App) StartSync(ruleID string) error {
	if syncMgr == nil {
		return fmt.Errorf("sync manager not initialized")
	}

	syncMgr.mu.RLock()
	rule, ok := syncMgr.rules[ruleID]
	if !ok {
		syncMgr.mu.RUnlock()
		return fmt.Errorf("sync rule not found: %s", ruleID)
	}
	// Copy rule data so we can release lock
	ruleCopy := *rule
	syncMgr.mu.RUnlock()

	// Stop existing sync if any
	a.StopSync(ruleID)

	// Find matching SSH config
	sshConfigs := GetSSHConfig()
	var targetConfig *SSHConfigEntry
	for i := range sshConfigs {
		if sshConfigs[i].Host == ruleCopy.SSHHost {
			targetConfig = &sshConfigs[i]
			break
		}
	}
	if targetConfig == nil {
		syncMgr.updateRuleStatus(ruleID, SyncStatusError, "", fmt.Sprintf("SSH host '%s' not found in config", ruleCopy.SSHHost))
		return fmt.Errorf("SSH host '%s' not found in config", ruleCopy.SSHHost)
	}

	// Establish dedicated SSH connection for sync
	sessionID, err := a.ConnectSSH(*targetConfig)
	if err != nil {
		syncMgr.updateRuleStatus(ruleID, SyncStatusError, "", fmt.Sprintf("SSH connection failed: %v", err))
		return fmt.Errorf("SSH connection failed: %v", err)
	}

	// Check remote dependencies
	deps := a.CheckRemoteSyncDeps(sessionID)

	ctx, cancel := context.WithCancel(syncMgr.ctx)

	state := &syncRuleState{
		rule:           &ruleCopy,
		sessionID:      sessionID,
		cancel:         cancel,
		hasRsync:       deps.HasRsync,
		hasInotify:     deps.HasInotify,
		remoteSnapshot: make(map[string]fileSnapshot),
	}

	syncMgr.mu.Lock()
	syncMgr.states[ruleID] = state
	syncMgr.rules[ruleID].Active = true
	syncMgr.rules[ruleID].Status = string(SyncStatusSyncing)
	// Keep state.rule pointing to the map entry so status updates are visible
	state.rule = syncMgr.rules[ruleID]
	syncMgr.mu.Unlock()

	syncMgr.emitLog(SyncLogEntry{
		RuleID:  ruleID,
		Action:  "info",
		Status:  "info",
		Message: fmt.Sprintf("Starting sync (rsync=%v, inotify=%v). %s", deps.HasRsync, deps.HasInotify, deps.Message),
	})
	syncMgr.updateRuleStatus(ruleID, SyncStatusSyncing, "Initial sync...", "")

	// Run sync lifecycle in background
	go func() {
		// Set syncing guard before initial sync to prevent local watcher
		// from triggering during the sync and immediately after.
		state.mu.Lock()
		state.syncing = true
		state.mu.Unlock()

		// Step 1: Initial full sync
		if err := syncMgr.performFullSync(ctx, state); err != nil {
			state.mu.Lock()
			state.syncing = false
			state.mu.Unlock()
			if ctx.Err() != nil {
				return // Cancelled, don't report error
			}
			syncMgr.updateRuleStatus(ruleID, SyncStatusError, "", fmt.Sprintf("Initial sync failed: %v", err))
			syncMgr.emitLog(SyncLogEntry{
				RuleID:  ruleID,
				Action:  "error",
				Status:  "error",
				Message: fmt.Sprintf("Initial sync failed: %v", err),
			})
			return
		}

		syncMgr.updateRuleStatus(ruleID, SyncStatusSynced, "Initial sync complete", "")

		// Step 2: Start real-time watchers
		syncMgr.startLocalWatcher(ctx, state)
		syncMgr.startRemoteWatcher(ctx, state)

		// Release syncing guard after cooldown so local watcher doesn't
		// immediately fire on the files rsync just wrote.
		time.AfterFunc(SyncCooldown, func() {
			state.mu.Lock()
			state.syncing = false
			state.mu.Unlock()
		})

		<-ctx.Done()
		log.Printf("🛑 [Sync] Rule %s stopped", ruleID)
	}()

	return nil
}

// StopSync stops syncing for a rule
func (a *App) StopSync(ruleID string) error {
	if syncMgr == nil {
		return nil
	}

	syncMgr.mu.Lock()
	state, ok := syncMgr.states[ruleID]
	if !ok {
		syncMgr.mu.Unlock()
		return nil
	}

	if state.cancel != nil {
		state.cancel()
	}
	if state.watcher != nil {
		state.watcher.Close()
	}
	if state.remoteSession != nil {
		state.remoteSession.Close()
	}

	// Disconnect the dedicated SSH session
	if state.sessionID != "" {
		closeSFTPClient(state.sessionID)
		sshManager.mu.Lock()
		if session, exists := sshManager.sessions[state.sessionID]; exists {
			if session.Client != nil {
				session.Client.Close()
			}
			delete(sshManager.sessions, state.sessionID)
		}
		sshManager.mu.Unlock()
	}

	delete(syncMgr.states, ruleID)

	if rule, ok := syncMgr.rules[ruleID]; ok {
		rule.Active = false
		rule.Status = string(SyncStatusIdle)
		rule.Error = ""
	}
	syncMgr.mu.Unlock()

	syncMgr.updateRuleStatus(ruleID, SyncStatusIdle, "Sync stopped", "")
	syncMgr.emitLog(SyncLogEntry{
		RuleID:  ruleID,
		Action:  "info",
		Status:  "info",
		Message: "Sync stopped",
	})
	return nil
}

// --- Sync execution ---

func (sm *SyncManager) performFullSync(ctx context.Context, state *syncRuleState) error {
	if state.hasRsync {
		return sm.rsyncFullSync(ctx, state)
	}
	return sm.sftpFullSync(ctx, state, state.rule.Source)
}

// rsyncFullSync performs full sync using rsync over SSH
func (sm *SyncManager) rsyncFullSync(ctx context.Context, state *syncRuleState) error {
	rule := state.rule

	sshManager.mu.RLock()
	session, exists := sshManager.sessions[state.sessionID]
	sshManager.mu.RUnlock()
	if !exists {
		return fmt.Errorf("SSH session not found")
	}

	config := session.Config
	hostname := config.Hostname
	if hostname == "" {
		hostname = config.Host
	}

	// Build SSH command string for rsync -e flag
	sshCmd := fmt.Sprintf("ssh -p %d -o StrictHostKeyChecking=no", config.Port)
	if config.IdentityFile != "" {
		identityFile := config.IdentityFile
		if strings.HasPrefix(identityFile, "~/") {
			usr, err := user.Current()
			if err == nil {
				identityFile = filepath.Join(usr.HomeDir, identityFile[2:])
			}
		}
		sshCmd += fmt.Sprintf(" -i %s", identityFile)
	}

	var src, dst string
	// Clean trailing slashes to avoid double-slash in paths
	cleanRemote := strings.TrimRight(rule.RemotePath, "/")
	cleanLocal := strings.TrimRight(rule.LocalPath, "/")
	remotePart := fmt.Sprintf("%s@%s:%s/", config.User, hostname, cleanRemote)

	if rule.Source == "local" {
		src = cleanLocal + "/"
		dst = remotePart
	} else {
		src = remotePart
		dst = cleanLocal + "/"
	}

	// Ensure local directory exists
	os.MkdirAll(cleanLocal, 0755)

	args := []string{
		"-avz", "--delete",
		"--timeout=30",
		"-e", sshCmd,
		src, dst,
	}

	sm.emitLog(SyncLogEntry{
		RuleID:  rule.ID,
		Action:  "info",
		Status:  "info",
		Message: fmt.Sprintf("Running rsync: %s -> %s", src, dst),
	})

	cmd := exec.CommandContext(ctx, "rsync", args...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("rsync failed: %v\nOutput: %s", err, string(output))
	}

	// Count synced files from rsync output
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	fileCount := 0
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "sending") || strings.HasPrefix(line, "receiving") ||
			strings.HasPrefix(line, "sent") || strings.HasPrefix(line, "total") ||
			strings.HasPrefix(line, "building") || line == "./" {
			continue
		}
		fileCount++
	}

	sm.emitLog(SyncLogEntry{
		RuleID:  rule.ID,
		Action:  "info",
		Status:  "success",
		Message: fmt.Sprintf("rsync complete: %d files synced", fileCount),
	})

	return nil
}

// sftpFullSync performs full sync using SFTP file comparison
func (sm *SyncManager) sftpFullSync(ctx context.Context, state *syncRuleState, source string) error {
	rule := state.rule

	sftpClient, err := getSFTPClient(state.sessionID)
	if err != nil {
		return fmt.Errorf("failed to get SFTP client: %v", err)
	}

	remotePath := resolveRemotePath(sftpClient, rule.RemotePath)
	remotePath = strings.TrimRight(remotePath, "/")
	localPath := strings.TrimRight(rule.LocalPath, "/")
	os.MkdirAll(localPath, 0755)

	localFiles, err := sm.buildLocalFileList(localPath)
	if err != nil {
		return fmt.Errorf("failed to list local files: %v", err)
	}

	remoteFiles, err := sm.buildRemoteFileList(sftpClient, remotePath)
	if err != nil {
		return fmt.Errorf("failed to list remote files: %v", err)
	}

	// Save remote snapshot for polling
	state.mu.Lock()
	state.remoteSnapshot = remoteFiles
	state.mu.Unlock()

	syncCount := 0

	if source == "local" {
		// Local -> Remote: push local files, delete remote-only files
		for relPath, localSnap := range localFiles {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if localSnap.IsDir {
				sftpClient.MkdirAll(remotePath + "/" + relPath)
				continue
			}
			remoteSnap, exists := remoteFiles[relPath]
			if !exists || localSnap.Size != remoteSnap.Size || localSnap.ModTime.After(remoteSnap.ModTime) {
				localFull := filepath.Join(localPath, relPath)
				remoteFull := remotePath + "/" + relPath
				sftpClient.MkdirAll(remotePath + "/" + filepath.Dir(relPath))
				if err := sm.uploadFileSFTP(sftpClient, localFull, remoteFull); err != nil {
					sm.emitLog(SyncLogEntry{RuleID: rule.ID, Action: "error", FilePath: relPath, Direction: "local->remote", Status: "error", Message: fmt.Sprintf("Upload failed: %v", err)})
					continue
				}
				syncCount++
				sm.emitLog(SyncLogEntry{RuleID: rule.ID, Action: "upload", FilePath: relPath, Direction: "local->remote", Status: "success"})
			}
		}
		for relPath, snap := range remoteFiles {
			if _, exists := localFiles[relPath]; !exists {
				remoteFull := remotePath + "/" + relPath
				if snap.IsDir {
					sm.removeRemoteDirRecursive(sftpClient, remoteFull)
				} else {
					sftpClient.Remove(remoteFull)
				}
				syncCount++
				sm.emitLog(SyncLogEntry{RuleID: rule.ID, Action: "delete", FilePath: relPath, Direction: "local->remote", Status: "success", Message: "Deleted from remote"})
			}
		}
	} else {
		// Remote -> Local: pull remote files, delete local-only files
		for relPath, remoteSnap := range remoteFiles {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if remoteSnap.IsDir {
				os.MkdirAll(filepath.Join(localPath, relPath), 0755)
				continue
			}
			localSnap, exists := localFiles[relPath]
			if !exists || remoteSnap.Size != localSnap.Size || remoteSnap.ModTime.After(localSnap.ModTime) {
				remoteFull := remotePath + "/" + relPath
				localFull := filepath.Join(localPath, relPath)
				os.MkdirAll(filepath.Dir(localFull), 0755)
				if err := sm.downloadFileSFTP(sftpClient, remoteFull, localFull); err != nil {
					sm.emitLog(SyncLogEntry{RuleID: rule.ID, Action: "error", FilePath: relPath, Direction: "remote->local", Status: "error", Message: fmt.Sprintf("Download failed: %v", err)})
					continue
				}
				syncCount++
				sm.emitLog(SyncLogEntry{RuleID: rule.ID, Action: "download", FilePath: relPath, Direction: "remote->local", Status: "success"})
			}
		}
		for relPath, snap := range localFiles {
			if _, exists := remoteFiles[relPath]; !exists {
				localFull := filepath.Join(localPath, relPath)
				if snap.IsDir {
					os.RemoveAll(localFull)
				} else {
					os.Remove(localFull)
				}
				syncCount++
				sm.emitLog(SyncLogEntry{RuleID: rule.ID, Action: "delete", FilePath: relPath, Direction: "remote->local", Status: "success", Message: "Deleted from local"})
			}
		}
	}

	sm.emitLog(SyncLogEntry{
		RuleID:  rule.ID,
		Action:  "info",
		Status:  "success",
		Message: fmt.Sprintf("SFTP sync complete: %d operations", syncCount),
	})
	return nil
}

// --- File list helpers ---

func (sm *SyncManager) buildLocalFileList(basePath string) (map[string]fileSnapshot, error) {
	result := make(map[string]fileSnapshot)
	err := filepath.Walk(basePath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		relPath, err := filepath.Rel(basePath, path)
		if err != nil || relPath == "." {
			return nil
		}
		result[relPath] = fileSnapshot{Size: info.Size(), ModTime: info.ModTime(), IsDir: info.IsDir()}
		return nil
	})
	return result, err
}

func (sm *SyncManager) buildRemoteFileList(sftpClient *sftp.Client, basePath string) (map[string]fileSnapshot, error) {
	result := make(map[string]fileSnapshot)
	walker := sftpClient.Walk(basePath)
	for walker.Step() {
		if err := walker.Err(); err != nil {
			continue
		}
		relPath, err := filepath.Rel(basePath, walker.Path())
		if err != nil || relPath == "." {
			continue
		}
		stat := walker.Stat()
		result[relPath] = fileSnapshot{Size: stat.Size(), ModTime: stat.ModTime(), IsDir: stat.IsDir()}
	}
	return result, nil
}

// --- SFTP transfer helpers ---

func (sm *SyncManager) uploadFileSFTP(sftpClient *sftp.Client, localPath, remotePath string) error {
	localFile, err := os.Open(localPath)
	if err != nil {
		return err
	}
	defer localFile.Close()

	remoteFile, err := sftpClient.Create(remotePath)
	if err != nil {
		return err
	}
	defer remoteFile.Close()

	_, err = io.Copy(remoteFile, localFile)
	return err
}

func (sm *SyncManager) downloadFileSFTP(sftpClient *sftp.Client, remotePath, localPath string) error {
	remoteFile, err := sftpClient.Open(remotePath)
	if err != nil {
		return err
	}
	defer remoteFile.Close()

	localFile, err := os.Create(localPath)
	if err != nil {
		return err
	}
	defer localFile.Close()

	_, err = io.Copy(localFile, remoteFile)
	return err
}

func (sm *SyncManager) removeRemoteDirRecursive(sftpClient *sftp.Client, path string) {
	walker := sftpClient.Walk(path)
	var files []string
	var dirs []string

	for walker.Step() {
		if err := walker.Err(); err != nil {
			continue
		}
		p := walker.Path()
		if p == path {
			continue
		}
		if walker.Stat().IsDir() {
			dirs = append([]string{p}, dirs...)
		} else {
			files = append(files, p)
		}
	}
	for _, f := range files {
		sftpClient.Remove(f)
	}
	for _, d := range dirs {
		sftpClient.RemoveDirectory(d)
	}
	sftpClient.RemoveDirectory(path)
}

// --- Real-time watchers ---

func (sm *SyncManager) startLocalWatcher(ctx context.Context, state *syncRuleState) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		sm.emitLog(SyncLogEntry{RuleID: state.rule.ID, Action: "error", Status: "error", Message: fmt.Sprintf("Failed to create local watcher: %v", err)})
		return
	}

	state.mu.Lock()
	state.watcher = watcher
	state.mu.Unlock()

	// Recursively add all subdirectories
	filepath.Walk(state.rule.LocalPath, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() {
			watcher.Add(path)
		}
		return nil
	})

	go func() {
		defer watcher.Close()
		for {
			select {
			case <-ctx.Done():
				return
			case event, ok := <-watcher.Events:
				if !ok {
					return
				}
				baseName := filepath.Base(event.Name)
				if strings.HasPrefix(baseName, ".") || strings.HasSuffix(baseName, "~") ||
					strings.HasSuffix(baseName, ".swp") || strings.HasSuffix(baseName, ".tmp") {
					continue
				}
				// Watch newly created directories
				if event.Has(fsnotify.Create) {
					if info, err := os.Stat(event.Name); err == nil && info.IsDir() {
						watcher.Add(event.Name)
					}
				}
				// Skip if a sync is already in progress or in cooldown.
				// This prevents the feedback loop: sync writes files locally ->
				// fsnotify fires -> triggers another sync -> infinite loop.
				state.mu.Lock()
				if state.syncing {
					state.mu.Unlock()
					continue
				}
				if state.debounceTimer != nil {
					state.debounceTimer.Stop()
				}
				state.debounceTimer = time.AfterFunc(SyncDebounceDelay, func() {
					sm.triggerIncrementalSync(ctx, state)
				})
				state.mu.Unlock()

			case err, ok := <-watcher.Errors:
				if !ok {
					return
				}
				log.Printf("⚠️ [Sync] fsnotify error: %v", err)
			}
		}
	}()

	sm.emitLog(SyncLogEntry{RuleID: state.rule.ID, Action: "info", Status: "info", Message: "Local file watcher started"})
}

func (sm *SyncManager) startRemoteWatcher(ctx context.Context, state *syncRuleState) {
	if state.hasInotify {
		sm.startInotifywaitWatcher(ctx, state)
	} else {
		sm.startPollingWatcher(ctx, state)
	}
}

func (sm *SyncManager) startInotifywaitWatcher(ctx context.Context, state *syncRuleState) {
	go func() {
		for {
			if ctx.Err() != nil {
				return
			}

			sshManager.mu.RLock()
			sshSession, exists := sshManager.sessions[state.sessionID]
			sshManager.mu.RUnlock()
			if !exists || !sshSession.Connected {
				log.Printf("⚠️ [Sync] SSH session lost for inotifywait, retrying in 5s...")
				time.Sleep(5 * time.Second)
				continue
			}

			session, err := sshSession.Client.NewSession()
			if err != nil {
				log.Printf("⚠️ [Sync] Failed to create inotifywait session: %v", err)
				time.Sleep(5 * time.Second)
				continue
			}

			state.mu.Lock()
			state.remoteSession = session
			state.mu.Unlock()

			stdout, err := session.StdoutPipe()
			if err != nil {
				session.Close()
				time.Sleep(5 * time.Second)
				continue
			}

			cmd := fmt.Sprintf("inotifywait -m -r -e modify,create,delete,move --format '%%w%%f %%e' %s", state.rule.RemotePath)
			if err := session.Start(cmd); err != nil {
				sm.emitLog(SyncLogEntry{RuleID: state.rule.ID, Action: "error", Status: "error", Message: fmt.Sprintf("Failed to start inotifywait: %v", err)})
				session.Close()
				// Fall back to polling
				sm.startPollingWatcher(ctx, state)
				return
			}

			sm.emitLog(SyncLogEntry{RuleID: state.rule.ID, Action: "info", Status: "info", Message: "Remote inotifywait watcher started"})

			scanner := bufio.NewScanner(stdout)
			var batchTimer *time.Timer

			for scanner.Scan() {
				if ctx.Err() != nil {
					session.Close()
					return
				}
				if batchTimer != nil {
					batchTimer.Stop()
				}
				batchTimer = time.AfterFunc(InotifywaitBatchWait, func() {
					sm.triggerIncrementalSync(ctx, state)
				})
			}

			session.Close()

			if ctx.Err() == nil {
				sm.emitLog(SyncLogEntry{RuleID: state.rule.ID, Action: "info", Status: "info", Message: "inotifywait disconnected, reconnecting in 5s..."})
				time.Sleep(5 * time.Second)
			}
		}
	}()
}

func (sm *SyncManager) startPollingWatcher(ctx context.Context, state *syncRuleState) {
	go func() {
		ticker := time.NewTicker(RemotePollInterval)
		defer ticker.Stop()

		sm.emitLog(SyncLogEntry{RuleID: state.rule.ID, Action: "info", Status: "info", Message: fmt.Sprintf("Remote polling watcher started (interval: %s)", RemotePollInterval)})

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				sftpClient, err := getSFTPClient(state.sessionID)
				if err != nil {
					continue
				}
				remotePath := resolveRemotePath(sftpClient, state.rule.RemotePath)
				currentFiles, err := sm.buildRemoteFileList(sftpClient, remotePath)
				if err != nil {
					continue
				}

				state.mu.Lock()
				changed := false
				old := state.remoteSnapshot

				for path, cur := range currentFiles {
					if prev, exists := old[path]; !exists || prev.Size != cur.Size || !prev.ModTime.Equal(cur.ModTime) {
						changed = true
						break
					}
				}
				if !changed {
					for path := range old {
						if _, exists := currentFiles[path]; !exists {
							changed = true
							break
						}
					}
				}
				state.remoteSnapshot = currentFiles
				state.mu.Unlock()

				if changed {
					sm.triggerIncrementalSync(ctx, state)
				}
			}
		}
	}()
}

// triggerIncrementalSync performs an incremental sync (source side always wins).
// It uses a syncing guard to prevent re-entrant calls caused by the local
// watcher picking up file writes that rsync/SFTP just made.
func (sm *SyncManager) triggerIncrementalSync(ctx context.Context, state *syncRuleState) {
	if ctx.Err() != nil {
		return
	}

	// Guard: if already syncing, skip this trigger entirely
	state.mu.Lock()
	if state.syncing {
		state.mu.Unlock()
		return
	}
	state.syncing = true
	state.mu.Unlock()

	defer func() {
		// After sync completes, keep the guard up for SyncCooldown to absorb
		// fsnotify events that fire because we just wrote files locally.
		time.AfterFunc(SyncCooldown, func() {
			state.mu.Lock()
			state.syncing = false
			state.mu.Unlock()
		})
	}()

	rule := state.rule
	sm.updateRuleStatus(rule.ID, SyncStatusSyncing, "Syncing changes...", "")

	var err error
	if state.hasRsync {
		err = sm.rsyncFullSync(ctx, state)
	} else {
		err = sm.sftpFullSync(ctx, state, rule.Source)
	}

	if err != nil {
		if ctx.Err() != nil {
			return
		}
		sm.updateRuleStatus(rule.ID, SyncStatusError, "", fmt.Sprintf("Sync failed: %v", err))
		return
	}

	sm.updateRuleStatus(rule.ID, SyncStatusSynced, "Fully synced", "")
}
