import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Button, Select, Input, Switch, Modal, message, Tooltip, Badge } from 'antd'
import {
  PlusOutlined,
  DeleteOutlined,
  QuestionCircleOutlined,
  SwapOutlined,
  ClearOutlined,
  CheckCircleOutlined,
  SyncOutlined,
  CloseCircleOutlined,
  MinusCircleOutlined,
} from '@ant-design/icons'
import {
  GetSSHConfig,
  GetSyncRules,
  AddSyncRule,
  RemoveSyncRule,
  StartSync,
  StopSync,
  SetSyncSource,
} from '../../../wailsjs/go/app/App'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import './SyncPanel.css'

interface SSHConfigEntry {
  id: string
  host: string
  hostname: string
  user: string
  port: number
  identityFile: string
}

interface SyncRule {
  id: string
  serverName: string
  sshHost: string
  remotePath: string
  localPath: string
  source: string
  active: boolean
  status: string
  lastSync: string
  error: string
}

interface SyncLogEntry {
  ruleId: string
  timestamp: string
  action: string
  filePath: string
  direction: string
  status: string
  message: string
}

interface SyncStatusEvent {
  ruleId: string
  status: string
  detail: string
  error: string
}

const SyncPanel: React.FC = () => {
  const [sshConfigs, setSshConfigs] = useState<SSHConfigEntry[]>([])
  const [rules, setRules] = useState<SyncRule[]>([])
  const [logs, setLogs] = useState<SyncLogEntry[]>([])
  const [helpVisible, setHelpVisible] = useState(false)
  const [loading, setLoading] = useState<{ [key: string]: boolean }>({})
  const logEndRef = useRef<HTMLDivElement>(null)

  // Draft state for new rule being composed
  const [draftServer, setDraftServer] = useState<string>('')
  const [draftRemotePath, setDraftRemotePath] = useState('')
  const [draftLocalPath, setDraftLocalPath] = useState('')
  const [draftSource, setDraftSource] = useState<string>('local')

  // Load SSH configs and sync rules on mount
  useEffect(() => {
    loadData()
  }, [])

  // Listen for sync events from backend
  useEffect(() => {
    const cleanupLog = EventsOn('sync:log', (entry: SyncLogEntry) => {
      setLogs(prev => {
        const next = [...prev, entry]
        // Cap at 500 entries
        return next.length > 500 ? next.slice(-500) : next
      })
    })

    const cleanupStatus = EventsOn('sync:status', (event: SyncStatusEvent) => {
      setRules(prev =>
        prev.map(r => {
          if (r.id === event.ruleId) {
            return {
              ...r,
              status: event.status,
              error: event.error,
              active: event.status !== 'idle',
              lastSync: event.status === 'synced' ? new Date().toISOString() : r.lastSync,
            }
          }
          return r
        })
      )
    })

    return () => {
      cleanupLog()
      cleanupStatus()
    }
  }, [])

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  const loadData = async () => {
    try {
      const [configs, syncRules] = await Promise.all([
        GetSSHConfig(),
        GetSyncRules(),
      ])
      setSshConfigs(configs || [])
      setRules(syncRules || [])
    } catch (err: any) {
      console.error('Failed to load sync data:', err)
      message.error('Failed to load sync data')
    }
  }

  const handleAddRule = useCallback(async () => {
    if (!draftServer) {
      message.warning('Please select a server')
      return
    }
    if (!draftRemotePath) {
      message.warning('Please enter remote path')
      return
    }
    if (!draftLocalPath) {
      message.warning('Please enter local path')
      return
    }

    try {
      const newRule = await AddSyncRule({
        id: '',
        serverName: draftServer,
        sshHost: draftServer,
        remotePath: draftRemotePath,
        localPath: draftLocalPath,
        source: draftSource,
        active: false,
        status: 'idle',
        lastSync: '',
        error: '',
      } as any)
      setRules(prev => [...prev, newRule])
      // Clear draft
      setDraftServer('')
      setDraftRemotePath('')
      setDraftLocalPath('')
      setDraftSource('local')
      message.success('Sync rule added')
    } catch (err: any) {
      message.error(`Failed to add rule: ${err?.message || err}`)
    }
  }, [draftServer, draftRemotePath, draftLocalPath, draftSource])

  const handleRemoveRule = useCallback(async (ruleId: string) => {
    try {
      await RemoveSyncRule(ruleId)
      setRules(prev => prev.filter(r => r.id !== ruleId))
      message.success('Sync rule removed')
    } catch (err: any) {
      message.error(`Failed to remove rule: ${err?.message || err}`)
    }
  }, [])

  const handleToggleSync = useCallback(async (rule: SyncRule, checked: boolean) => {
    setLoading(prev => ({ ...prev, [rule.id]: true }))
    try {
      if (checked) {
        await StartSync(rule.id)
        setRules(prev =>
          prev.map(r => (r.id === rule.id ? { ...r, active: true, status: 'syncing' } : r))
        )
      } else {
        await StopSync(rule.id)
        setRules(prev =>
          prev.map(r => (r.id === rule.id ? { ...r, active: false, status: 'idle' } : r))
        )
      }
    } catch (err: any) {
      message.error(`Failed to ${checked ? 'start' : 'stop'} sync: ${err?.message || err}`)
    } finally {
      setLoading(prev => ({ ...prev, [rule.id]: false }))
    }
  }, [])

  const handleChangeSource = useCallback(async (ruleId: string, source: string) => {
    try {
      await SetSyncSource(ruleId, source)
      setRules(prev =>
        prev.map(r => (r.id === ruleId ? { ...r, source } : r))
      )
    } catch (err: any) {
      message.error(`Failed to change source: ${err?.message || err}`)
    }
  }, [])

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'synced':
        return <CheckCircleOutlined style={{ color: '#52c41a' }} />
      case 'syncing':
        return <SyncOutlined spin style={{ color: '#1890ff' }} />
      case 'error':
        return <CloseCircleOutlined style={{ color: '#ff4d4f' }} />
      default:
        return <MinusCircleOutlined style={{ color: '#888' }} />
    }
  }

  const getStatusText = (status: string) => {
    switch (status) {
      case 'synced':
        return 'Synced'
      case 'syncing':
        return 'Syncing...'
      case 'error':
        return 'Error'
      default:
        return 'Idle'
    }
  }

  const getLogIcon = (action: string) => {
    switch (action) {
      case 'upload':
        return '\u2191'   // up arrow
      case 'download':
        return '\u2193'   // down arrow
      case 'delete':
        return '\u2717'   // x mark
      case 'error':
        return '\u26a0'   // warning
      default:
        return '\u2139'   // info
    }
  }

  const getLogClass = (status: string) => {
    switch (status) {
      case 'success':
        return 'log-success'
      case 'error':
        return 'log-error'
      default:
        return 'log-info'
    }
  }

  const formatTime = (timestamp: string) => {
    try {
      const d = new Date(timestamp)
      return d.toLocaleTimeString('en-US', { hour12: false })
    } catch {
      return timestamp
    }
  }

  // Summary status across all rules
  const activeRules = rules.filter(r => r.active)
  const syncedCount = rules.filter(r => r.status === 'synced').length
  const syncingCount = rules.filter(r => r.status === 'syncing').length
  const errorCount = rules.filter(r => r.status === 'error').length

  return (
    <div className="sync-panel">
      {/* Header */}
      <div className="sync-header">
        <div className="sync-header-left">
          <span className="sync-title">Directory Sync</span>
          <span className="sync-summary">
            {activeRules.length === 0 && 'No active sync'}
            {syncedCount > 0 && (
              <Badge status="success" text={`${syncedCount} synced`} style={{ marginRight: 12 }} />
            )}
            {syncingCount > 0 && (
              <Badge status="processing" text={`${syncingCount} syncing`} style={{ marginRight: 12 }} />
            )}
            {errorCount > 0 && (
              <Badge status="error" text={`${errorCount} error`} />
            )}
          </span>
        </div>
        <div className="sync-header-right">
          <Tooltip title="Installation Help">
            <Button
              icon={<QuestionCircleOutlined />}
              size="small"
              onClick={() => setHelpVisible(true)}
            />
          </Tooltip>
        </div>
      </div>

      {/* Rules list */}
      <div className="sync-rules">
        {/* Existing rules */}
        {rules.map((rule) => (
          <div key={rule.id} className={`sync-rule-row ${rule.status === 'error' ? 'rule-error' : ''}`}>
            <div className="rule-server">
              <span className="rule-server-name" title={rule.sshHost}>
                {rule.sshHost}
              </span>
            </div>
            <div className="rule-paths">
              <Input
                value={rule.remotePath}
                size="small"
                readOnly
                className="rule-path-input"
                prefix={<span className="path-label">Remote</span>}
              />
              <Input
                value={rule.localPath}
                size="small"
                readOnly
                className="rule-path-input"
                prefix={<span className="path-label">Local</span>}
              />
            </div>
            <div className="rule-source">
              <Select
                value={rule.source}
                size="small"
                onChange={(val) => handleChangeSource(rule.id, val)}
                options={[
                  { value: 'local', label: 'Local\u2192Remote' },
                  { value: 'remote', label: 'Remote\u2192Local' },
                ]}
                className="source-select"
                disabled={rule.active}
              />
            </div>
            <div className="rule-status">
              <Tooltip title={rule.error || getStatusText(rule.status)}>
                <span className="status-indicator">
                  {getStatusIcon(rule.status)}
                  <span className="status-text">{getStatusText(rule.status)}</span>
                </span>
              </Tooltip>
            </div>
            <div className="rule-actions">
              <Switch
                checked={rule.active}
                onChange={(checked) => handleToggleSync(rule, checked)}
                loading={loading[rule.id]}
                size="small"
              />
              <Button
                icon={<DeleteOutlined />}
                size="small"
                danger
                onClick={() => handleRemoveRule(rule.id)}
                disabled={rule.active}
                className="rule-delete-btn"
              />
            </div>
          </div>
        ))}

        {/* Add new rule form */}
        <div className="sync-rule-row sync-rule-draft">
          <div className="rule-server">
            <Select
              value={draftServer || undefined}
              placeholder="Server"
              size="small"
              onChange={setDraftServer}
              options={sshConfigs.map(c => ({
                value: c.host,
                label: c.host,
              }))}
              className="server-select"
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
              }
            />
          </div>
          <div className="rule-paths">
            <Input
              placeholder="/remote/path"
              value={draftRemotePath}
              onChange={(e) => setDraftRemotePath(e.target.value)}
              size="small"
              className="rule-path-input"
              prefix={<span className="path-label">Remote</span>}
            />
            <Input
              placeholder="/local/path"
              value={draftLocalPath}
              onChange={(e) => setDraftLocalPath(e.target.value)}
              size="small"
              className="rule-path-input"
              prefix={<span className="path-label">Local</span>}
            />
          </div>
          <div className="rule-source">
            <Select
              value={draftSource}
              size="small"
              onChange={setDraftSource}
              options={[
                { value: 'local', label: 'Local\u2192Remote' },
                { value: 'remote', label: 'Remote\u2192Local' },
              ]}
              className="source-select"
            />
          </div>
          <div className="rule-status" />
          <div className="rule-actions">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              size="small"
              onClick={handleAddRule}
            >
              Add
            </Button>
          </div>
        </div>
      </div>

      {/* Log area */}
      <div className="sync-log-section">
        <div className="sync-log-header">
          <span className="sync-log-title">Sync Log</span>
          <Button
            icon={<ClearOutlined />}
            size="small"
            onClick={() => setLogs([])}
          >
            Clear
          </Button>
        </div>
        <div className="sync-log-list">
          {logs.length === 0 ? (
            <div className="sync-log-empty">No sync activity yet</div>
          ) : (
            logs.map((log, i) => (
              <div key={i} className={`sync-log-entry ${getLogClass(log.status)}`}>
                <span className="log-time">{formatTime(log.timestamp)}</span>
                <span className="log-icon">{getLogIcon(log.action)}</span>
                <span className="log-content">
                  {log.filePath && <span className="log-file">{log.filePath}</span>}
                  {log.direction && <span className="log-direction">({log.direction})</span>}
                  {log.message && <span className="log-message">{log.message}</span>}
                </span>
              </div>
            ))
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* Help Modal */}
      <Modal
        title="Sync Dependencies Installation"
        open={helpVisible}
        onCancel={() => setHelpVisible(false)}
        footer={[
          <Button key="close" onClick={() => setHelpVisible(false)}>
            Close
          </Button>,
        ]}
        width={600}
      >
        <div className="help-content">
          <h3>Required Packages on Remote Server</h3>
          <p>
            For optimal sync performance, install these packages on your remote server.
            The sync feature will still work without them (using SFTP fallback and polling),
            but performance and real-time detection will be degraded.
          </p>

          <h4>1. rsync (Recommended - for efficient file transfer)</h4>
          <p>Without rsync, sync uses SFTP which transfers whole files instead of incremental diffs.</p>
          <pre className="help-code">
{`# Ubuntu / Debian
sudo apt-get install rsync

# CentOS / RHEL / Fedora
sudo yum install rsync
# or
sudo dnf install rsync

# Alpine
apk add rsync

# macOS (usually pre-installed)
brew install rsync`}
          </pre>

          <h4>2. inotify-tools (Recommended - for real-time file change detection)</h4>
          <p>Without inotifywait, the sync uses periodic polling (every 5 seconds) to detect changes.</p>
          <pre className="help-code">
{`# Ubuntu / Debian
sudo apt-get install inotify-tools

# CentOS / RHEL / Fedora
sudo yum install inotify-tools
# or
sudo dnf install inotify-tools

# Alpine
apk add inotify-tools`}
          </pre>

          <h4>How it works</h4>
          <ul>
            <li><strong>With rsync:</strong> Uses rsync over SSH for efficient incremental sync (only changed bytes are transferred)</li>
            <li><strong>Without rsync:</strong> Falls back to SFTP-based sync (compares file size/mtime, transfers entire changed files)</li>
            <li><strong>With inotifywait:</strong> Real-time file change detection on remote server</li>
            <li><strong>Without inotifywait:</strong> Polls remote directory every 5 seconds for changes</li>
            <li><strong>Local changes:</strong> Always detected in real-time using OS-native file watching (fsnotify)</li>
          </ul>

          <h4>Sync Direction</h4>
          <p>
            The <strong>Source</strong> side always wins in case of conflicts. If you set Source = Local,
            your local directory is the "truth" and remote will be overwritten to match it.
          </p>
        </div>
      </Modal>
    </div>
  )
}

export default SyncPanel
