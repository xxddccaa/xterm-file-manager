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
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation(['sync', 'common'])
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
      message.error(t('failedToLoadSyncData'))
    }
  }

  const handleAddRule = useCallback(async () => {
    if (!draftServer) {
      message.warning(t('pleaseSelectServer'))
      return
    }
    if (!draftRemotePath) {
      message.warning(t('pleaseEnterRemotePath'))
      return
    }
    if (!draftLocalPath) {
      message.warning(t('pleaseEnterLocalPath'))
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
      message.success(t('syncRuleAdded'))
    } catch (err: any) {
      message.error(t('failedToAddRule', { error: err?.message || err }))
    }
  }, [draftServer, draftRemotePath, draftLocalPath, draftSource, t])

  const handleRemoveRule = useCallback(async (ruleId: string) => {
    try {
      await RemoveSyncRule(ruleId)
      setRules(prev => prev.filter(r => r.id !== ruleId))
      message.success(t('syncRuleRemoved'))
    } catch (err: any) {
      message.error(t('failedToRemoveRule', { error: err?.message || err }))
    }
  }, [t])

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
      message.error(t('failedToActionSync', { 
        action: checked ? t('start') : t('stop'), 
        error: err?.message || err 
      }))
    } finally {
      setLoading(prev => ({ ...prev, [rule.id]: false }))
    }
  }, [t])

  const handleChangeSource = useCallback(async (ruleId: string, source: string) => {
    try {
      await SetSyncSource(ruleId, source)
      setRules(prev =>
        prev.map(r => (r.id === ruleId ? { ...r, source } : r))
      )
    } catch (err: any) {
      message.error(t('failedToChangeSource', { error: err?.message || err }))
    }
  }, [t])

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
        return t('statusSynced')
      case 'syncing':
        return t('statusSyncing')
      case 'error':
        return t('statusError')
      default:
        return t('statusIdle')
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
          <span className="sync-title">{t('directorySync')}</span>
          <span className="sync-summary">
            {activeRules.length === 0 && t('noActiveSync')}
            {syncedCount > 0 && (
              <Badge status="success" text={t('synced', { n: syncedCount })} style={{ marginRight: 12 }} />
            )}
            {syncingCount > 0 && (
              <Badge status="processing" text={t('syncing', { n: syncingCount })} style={{ marginRight: 12 }} />
            )}
            {errorCount > 0 && (
              <Badge status="error" text={t('errorCount', { n: errorCount })} />
            )}
          </span>
        </div>
        <div className="sync-header-right">
          <Tooltip title={t('installationHelp')}>
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
                prefix={<span className="path-label">{t('remote')}</span>}
              />
              <Input
                value={rule.localPath}
                size="small"
                readOnly
                className="rule-path-input"
                prefix={<span className="path-label">{t('local')}</span>}
              />
            </div>
            <div className="rule-source">
              <Select
                value={rule.source}
                size="small"
                onChange={(val) => handleChangeSource(rule.id, val)}
                options={[
                  { value: 'local', label: t('localToRemote') },
                  { value: 'remote', label: t('remoteToLocal') },
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
              placeholder={t('server')}
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
              placeholder={t('remotePlaceholder')}
              value={draftRemotePath}
              onChange={(e) => setDraftRemotePath(e.target.value)}
              size="small"
              className="rule-path-input"
              prefix={<span className="path-label">{t('remote')}</span>}
            />
            <Input
              placeholder={t('localPlaceholder')}
              value={draftLocalPath}
              onChange={(e) => setDraftLocalPath(e.target.value)}
              size="small"
              className="rule-path-input"
              prefix={<span className="path-label">{t('local')}</span>}
            />
          </div>
          <div className="rule-source">
            <Select
              value={draftSource}
              size="small"
              onChange={setDraftSource}
              options={[
                { value: 'local', label: t('localToRemote') },
                { value: 'remote', label: t('remoteToLocal') },
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
              {t('add')}
            </Button>
          </div>
        </div>
      </div>

      {/* Log area */}
      <div className="sync-log-section">
        <div className="sync-log-header">
          <span className="sync-log-title">{t('syncLog')}</span>
          <Button
            icon={<ClearOutlined />}
            size="small"
            onClick={() => setLogs([])}
          >
            {t('clear')}
          </Button>
        </div>
        <div className="sync-log-list">
          {logs.length === 0 ? (
            <div className="sync-log-empty">{t('noSyncActivity')}</div>
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
        title={t('syncDependenciesTitle')}
        open={helpVisible}
        onCancel={() => setHelpVisible(false)}
        footer={[
          <Button key="close" onClick={() => setHelpVisible(false)}>
            {t('common:close')}
          </Button>,
        ]}
        width={600}
      >
        <div className="help-content">
          <h3>{t('requiredPackages')}</h3>
          <p>
            {t('helpIntro')}
          </p>

          <h4>{t('rsyncRecommended')}</h4>
          <p>{t('rsyncDescription')}</p>
          <pre className="help-code">
{t('rsyncInstallCommands')}
          </pre>

          <h4>{t('inotifyRecommended')}</h4>
          <p>{t('inotifyDescription')}</p>
          <pre className="help-code">
{t('inotifyInstallCommands')}
          </pre>

          <h4>{t('howItWorks')}</h4>
          <ul>
            <li><strong>{t('withRsync')}</strong></li>
            <li><strong>{t('withoutRsync')}</strong></li>
            <li><strong>{t('withInotify')}</strong></li>
            <li><strong>{t('withoutInotify')}</strong></li>
            <li><strong>{t('localChanges')}</strong></li>
          </ul>

          <h4>{t('syncDirection')}</h4>
          <p>
            {t('syncDirectionDescription')}
          </p>
        </div>
      </Modal>
    </div>
  )
}

export default SyncPanel
