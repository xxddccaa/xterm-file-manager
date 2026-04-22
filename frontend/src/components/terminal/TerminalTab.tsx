import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Layout, Input, Button, List, Spin, Modal, message, Tooltip } from 'antd'
import { SearchOutlined, PlusOutlined, CloseOutlined, EditOutlined, LeftOutlined, RightOutlined, SortAscendingOutlined, SortDescendingOutlined, MenuOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { main } from '../../../wailsjs/go/models'
type SSHConfigEntry = main.SSHConfigEntry
import { ClearSSHPasswordCache, ConnectSSH, ConnectSSHWithAuth, CreateLocalTerminalSession, GetSSHConfig, GetTerminalSettings, DisconnectSSH, DownloadFile, UploadFile, WriteToTerminal, CloseTerminalSession, OpenEditorWindow, GetHomeDirectory, SaveTerminalSessions, LoadTerminalSessions, ReadLocalFile, WriteLocalFile } from '../../../wailsjs/go/app/App'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import Terminal from './Terminal'
import CommandPanel from './CommandPanel'
import FileManager from '../file-manager/FileManager'
import LocalFileManager from '../file-manager/LocalFileManager'
import { escapeShellPaths } from '../../utils/shellEscape'
import { getDragPayload, clearDragPayload, setDragTarget, clearDragTarget, getDragTarget } from '../../utils/dragState'
import { dlog } from '../../utils/debugLog'
import { haveSameSSHConfigOrder, reorderSSHConfigContent, reorderSSHConfigsByVisibleHosts, sortSSHConfigsByName } from '../../utils/sshConfigOrdering'
import { clearTerminalHistory } from './terminalHistory'
import './TerminalTab.css'

const { Sider, Content } = Layout

interface Session {
  tabId: string
  id: string
  name: string
  customName?: string  // User-defined custom name (if renamed)
  connected: boolean
  type: 'ssh' | 'local'
  initialDir?: string  // Optional initial directory for local terminals
  sshHost?: string  // SSH config host name for reconnection
}

interface PersistedSession {
  tabId?: string
  id: string
  name: string
  customName?: string
  type: 'ssh' | 'local'
  initialDir?: string
  sshHost?: string
}

interface TerminalSettings {
  enableSelectToCopy: boolean
  enableRightClickPaste: boolean
}

type AuthPromptKind = 'password' | 'key_passphrase'

interface AuthPromptState {
  visible: boolean
  kind: AuthPromptKind
  config: SSHConfigEntry | null
  sessionRefId: string | null
  removeSessionOnCancel: boolean
  showSuccessToast: boolean
  reasonCode: 'missing' | 'cached_invalid'
  host: string
  identityFile: string
  errorMessage: string
  submitting: boolean
}

interface ParsedSSHConnectError {
  kind: 'password_required' | 'password_invalid' | 'key_passphrase_required' | 'key_passphrase_invalid' | 'other'
  reasonCode?: 'missing' | 'cached_invalid'
  host?: string
  identityFile?: string
  message: string
}

type PaneKey = 'terminal' | 'commands' | 'remote' | 'local'
type CollapsiblePane = Exclude<PaneKey, 'terminal'>
type PaneWidths = Record<PaneKey, number>

interface PaneDragState {
  leftPane: PaneKey
  rightPane: PaneKey
}

const SSH_PASSWORD_REQUIRED_PREFIX = 'SSH_PASSWORD_REQUIRED:'
const SSH_PASSWORD_INVALID_PREFIX = 'SSH_PASSWORD_INVALID:'
const SSH_KEY_PASSPHRASE_REQUIRED_PREFIX = 'SSH_KEY_PASSPHRASE_REQUIRED:'
const SSH_KEY_PASSPHRASE_INVALID_PREFIX = 'SSH_KEY_PASSPHRASE_INVALID:'

const createTabId = (): string => `tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

const parseErrorPayload = (payload: string, expectedParts: number): string[] => {
  const parts = payload.split('|')
  if (parts.length <= expectedParts) {
    return parts
  }

  const head = parts.slice(0, expectedParts - 1)
  const tail = parts.slice(expectedParts - 1).join('|')
  return [...head, tail]
}

const getErrorMessage = (error: any): string => {
  if (typeof error === 'string') return error
  if (error?.message) return error.message
  return String(error)
}

const parseSSHConnectError = (error: any): ParsedSSHConnectError => {
  const rawMessage = getErrorMessage(error)

  if (rawMessage.startsWith(SSH_PASSWORD_REQUIRED_PREFIX)) {
    const payload = rawMessage.slice(SSH_PASSWORD_REQUIRED_PREFIX.length)
    const [reasonCode = 'missing', host = '', message = ''] = parseErrorPayload(payload, 3)
    return {
      kind: 'password_required',
      reasonCode: reasonCode === 'cached_invalid' ? 'cached_invalid' : 'missing',
      host,
      message: message || rawMessage,
    }
  }

  if (rawMessage.startsWith(SSH_PASSWORD_INVALID_PREFIX)) {
    const payload = rawMessage.slice(SSH_PASSWORD_INVALID_PREFIX.length)
    const [host = '', message = ''] = parseErrorPayload(payload, 2)
    return {
      kind: 'password_invalid',
      host,
      message: message || rawMessage,
    }
  }

  if (rawMessage.startsWith(SSH_KEY_PASSPHRASE_REQUIRED_PREFIX)) {
    const payload = rawMessage.slice(SSH_KEY_PASSPHRASE_REQUIRED_PREFIX.length)
    const [reasonCode = 'missing', identityFile = '', host = '', message = ''] = parseErrorPayload(payload, 4)
    return {
      kind: 'key_passphrase_required',
      reasonCode: reasonCode === 'cached_invalid' ? 'cached_invalid' : 'missing',
      identityFile,
      host,
      message: message || rawMessage,
    }
  }

  if (rawMessage.startsWith(SSH_KEY_PASSPHRASE_INVALID_PREFIX)) {
    const payload = rawMessage.slice(SSH_KEY_PASSPHRASE_INVALID_PREFIX.length)
    const [identityFile = '', host = '', message = ''] = parseErrorPayload(payload, 3)
    return {
      kind: 'key_passphrase_invalid',
      identityFile,
      host,
      message: message || rawMessage,
    }
  }

  return {
    kind: 'other',
    message: rawMessage,
  }
}

const TerminalTab: React.FC = () => {
  const { t } = useTranslation(['terminal', 'common'])
  const [sshConfigs, setSshConfigs] = useState<SSHConfigEntry[]>([])
  const [savingServerOrder, setSavingServerOrder] = useState(false)
  const [draggedServerHost, setDraggedServerHost] = useState<string | null>(null)
  const [searchText, setSearchText] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  // Keep latest state in refs so we can persist on unmount/window close
  const sessionsRef = useRef<Session[]>([])
  const activeSessionIdRef = useRef<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sidebarCollapsed] = useState(false)
  const [terminalSettings, setTerminalSettings] = useState<TerminalSettings>({
    enableSelectToCopy: true,
    enableRightClickPaste: true,
  })
  const [collapsedPanes, setCollapsedPanes] = useState<Record<CollapsiblePane, boolean>>({
    commands: false,
    remote: false,
    local: false,
  })
  
  // Pane widths for resizable dividers
  const [paneWidths, setPaneWidths] = useState<PaneWidths>({
    terminal: 40,
    commands: 18,
    remote: 22,
    local: 20,
  })
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef<PaneDragState | null>(null)
  const startXRef = useRef(0)
  const startWidthsRef = useRef<PaneWidths>({
    terminal: 40,
    commands: 18,
    remote: 22,
    local: 20,
  })
  
  // Refresh triggers for file panels
  const [remoteRefreshKey, setRemoteRefreshKey] = useState(0)
  const [localRefreshKey, setLocalRefreshKey] = useState(0)
  
  // Guard: track hosts currently being connected to prevent rapid duplicate clicks
  const connectingHostsRef = useRef<Set<string>>(new Set())

  // Drag and drop state for visual feedback
  const [isDraggingFile, setIsDraggingFile] = useState(false)
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [contentEl, setContentEl] = useState<HTMLElement | null>(null)
  const contentRefCb = useCallback((el: HTMLElement | null) => { setContentEl(el) }, [])

  // Tab drag and drop state for reordering
  const [draggedTabIndex, setDraggedTabIndex] = useState<number | null>(null)

  // Tab rename state
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<any>(null)

  // Tab context menu state (right-click)
  const [tabContextMenu, setTabContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    sessionId: string
    index: number
  }>({ visible: false, x: 0, y: 0, sessionId: '', index: -1 })
  const [authPrompt, setAuthPrompt] = useState<AuthPromptState>({
    visible: false,
    kind: 'password',
    config: null,
    sessionRefId: null,
    removeSessionOnCancel: false,
    showSuccessToast: false,
    reasonCode: 'missing',
    host: '',
    identityFile: '',
    errorMessage: '',
    submitting: false,
  })
  const [authInput, setAuthInput] = useState('')
  const serverOrderChangedRef = useRef(false)
  const persistedSSHConfigsRef = useRef<SSHConfigEntry[]>([])
  const suppressServerClickRef = useRef(false)

  useEffect(() => {
    loadSSHConfig()
    loadTerminalSettings()
    loadSavedSessions()  // Load saved sessions on startup
    
    // Listen for settings changes
    const cleanup = EventsOn('terminal:settings-changed', (settings: TerminalSettings) => {
      setTerminalSettings(settings)
    })
    
    // Listen for terminal disconnections to update session status
    const cleanupDisconnect = EventsOn('terminal:disconnected', (payload: any) => {
      if (payload && payload.sessionId) {
        setSessions(prev => prev.map(s => 
          s.id === payload.sessionId ? { ...s, connected: false } : s
        ))
      }
    })
    
    // Listen for SSH config file changes (saved from editor)
    const cleanupSSHConfigChanged = EventsOn('ssh:config-changed', (payload: any) => {
      console.log('🔐 SSH config file saved, reloading configuration...')
      loadSSHConfig()
    })
    
    // Listen for editor window closed to reload SSH config (backward compatibility)
    const cleanupEditorClosed = EventsOn('editor:window-closed', (payload: any) => {
      // Check if the closed file is SSH config
      if (payload && payload.filePath && payload.filePath.includes('/.ssh/config')) {
        console.log('📝 SSH config editor closed, reloading configuration...')
        loadSSHConfig()
      }
    })
    
    return () => {
      cleanup()
      cleanupDisconnect()
      cleanupSSHConfigChanged()
      cleanupEditorClosed()
    }
  }, [])

  useEffect(() => {
    sessionsRef.current = sessions
    activeSessionIdRef.current = activeSessionId
  }, [sessions, activeSessionId])

  const persistSessions = useCallback(async (nextSessions: Session[], nextActiveSessionId: string | null) => {
    if (nextSessions.length === 0) {
      try {
        await SaveTerminalSessions(JSON.stringify({ sessions: [], activeSessionId: null }))
        console.log('💾 Cleared persisted terminal sessions (no open tabs)')
      } catch (error) {
        console.error('Failed to clear sessions:', error)
      }
      return
    }

    try {
      const data = {
        sessions: nextSessions.map(s => ({
          tabId: s.tabId,
          // Persist a stable id for sessions that haven't connected yet
          id: s.id,
          name: s.name,
          customName: s.customName,
          type: s.type,
          initialDir: s.initialDir,
          sshHost: s.sshHost,
        })),
        activeSessionId: nextActiveSessionId
      }
      await SaveTerminalSessions(JSON.stringify(data))
      console.log('💾 Saved terminal sessions:', nextSessions.length)
    } catch (error) {
      console.error('Failed to save sessions:', error)
    }
  }, [])

  // Auto-save sessions when they change (with debounce)
  useEffect(() => {
    const timer = setTimeout(() => {
      persistSessions(sessions, activeSessionId)
    }, 500)
    return () => clearTimeout(timer)
  }, [sessions, activeSessionId, persistSessions])

  // Best-effort persist on unmount (e.g. app close)
  useEffect(() => {
    return () => {
      persistSessions(sessionsRef.current, activeSessionIdRef.current)
    }
  }, [persistSessions])

  const loadSSHConfig = async () => {
    try {
      const configs = await GetSSHConfig()
      const nextConfigs = configs || []
      setSshConfigs(nextConfigs)
      persistedSSHConfigsRef.current = nextConfigs
    } catch (error) {
      console.error('Failed to load SSH config:', error)
      message.error(t('terminal:failedToLoadSSHConfig'))
    } finally {
      setLoading(false)
    }
  }

  const loadTerminalSettings = async () => {
    try {
      const settingsJSON = await GetTerminalSettings()
      const settings = JSON.parse(settingsJSON) as TerminalSettings
      setTerminalSettings(settings)
    } catch (error) {
      console.error('Failed to load terminal settings:', error)
      // Use default settings on error
    }
  }

  // Save sessions to disk (legacy wrapper)
  const saveSessions = async () => {
    await persistSessions(sessions, activeSessionId)
  }

  // Load saved sessions and reconnect
  const loadSavedSessions = async () => {
    try {
      const dataJSON = await LoadTerminalSessions()
      if (!dataJSON || dataJSON === '{}') return
      
      const data = JSON.parse(dataJSON)
      if (!data.sessions || data.sessions.length === 0) return

      console.log('📂 Loading saved sessions:', data.sessions.length)

      // Restore tabs ONLY (do not connect yet). Use stable ids so we can map to real ids later.
      const restored: Session[] = (data.sessions as PersistedSession[]).map((s, idx) => {
        const stableId = s.id && typeof s.id === 'string' ? s.id : `restored-${idx}-${Date.now()}`
        const tabId = s.tabId && typeof s.tabId === 'string' ? s.tabId : stableId
        return {
          tabId,
          id: stableId,
          name: s.name,
          customName: s.customName,
          connected: false,
          type: s.type,
          initialDir: s.initialDir,
          sshHost: s.sshHost,
        }
      })
      setSessions(restored)

      // Restore active tab (still disconnected)
      if (data.activeSessionId && restored.some(s => s.id === data.activeSessionId)) {
        setActiveSessionId(data.activeSessionId)
      } else {
        setActiveSessionId(restored.length > 0 ? restored[0].id : null)
      }
    } catch (error) {
      console.error('Failed to load sessions:', error)
    }
  }

  const removeSessionPlaceholder = useCallback((sessionId: string) => {
    setSessions(prev => {
      const removedSession = prev.find(s => s.id === sessionId)
      if (removedSession) {
        clearTerminalHistory(removedSession.tabId)
      }
      const remaining = prev.filter(s => s.id !== sessionId)
      setActiveSessionId(current => current === sessionId ? (remaining.length > 0 ? remaining[0].id : null) : current)
      return remaining
    })
  }, [])

  const finalizeSSHConnection = useCallback((sessionRefId: string, sessionId: string, host: string, showSuccessToast: boolean) => {
    setSessions(prev => prev.map(s =>
      s.id === sessionRefId
        ? { ...s, id: sessionId, connected: true, sshHost: host, name: host }
        : s
    ))
    setActiveSessionId(sessionId)

    if (showSuccessToast) {
      message.success(t('terminal:connectedToHost', { host }))
    }
  }, [t])

  const closeAuthPrompt = useCallback(() => {
    setAuthPrompt({
      visible: false,
      kind: 'password',
      config: null,
      sessionRefId: null,
      removeSessionOnCancel: false,
      showSuccessToast: false,
      reasonCode: 'missing',
      host: '',
      identityFile: '',
      errorMessage: '',
      submitting: false,
    })
    setAuthInput('')
  }, [])

  const showAuthPromptForError = useCallback((
    parsedError: ParsedSSHConnectError,
    config: SSHConfigEntry,
    sessionRefId: string,
    removeSessionOnCancel: boolean,
    showSuccessToast: boolean,
  ) => {
    if (parsedError.kind !== 'password_required' && parsedError.kind !== 'key_passphrase_required') {
      return
    }

    const promptKind: AuthPromptKind = parsedError.kind === 'password_required' ? 'password' : 'key_passphrase'
    const reasonCode = parsedError.reasonCode || 'missing'

    setAuthPrompt({
      visible: true,
      kind: promptKind,
      config,
      sessionRefId,
      removeSessionOnCancel,
      showSuccessToast,
      reasonCode,
      host: parsedError.host || config.host,
      identityFile: parsedError.identityFile || '',
      errorMessage: reasonCode === 'cached_invalid'
        ? (
          promptKind === 'password'
            ? t('terminal:sshPasswordCachedInvalid')
            : t('terminal:sshKeyPassphraseCachedInvalid')
        )
        : '',
      submitting: false,
    })
    setAuthInput('')
  }, [t])

  const attemptSSHConnection = useCallback(async (
    config: SSHConfigEntry,
    sessionRefId: string,
    removeSessionOnPromptCancel: boolean,
    showSuccessToast: boolean,
  ) => {
    try {
      const sessionId = await ConnectSSH(config)
      finalizeSSHConnection(sessionRefId, sessionId, config.host, showSuccessToast)
      return true
    } catch (error: any) {
      const parsedError = parseSSHConnectError(error)
      if (parsedError.kind === 'password_required' || parsedError.kind === 'key_passphrase_required') {
        showAuthPromptForError(parsedError, config, sessionRefId, removeSessionOnPromptCancel, showSuccessToast)
        return false
      }

      throw new Error(parsedError.message)
    }
  }, [finalizeSSHConnection, showAuthPromptForError])

  const connectSessionIfNeeded = useCallback(async (session: Session) => {
    if (session.connected) return

    if (session.type === 'ssh') {
      const host = session.sshHost || session.name
      if (!host) return

      if (connectingHostsRef.current.has(host)) return
      connectingHostsRef.current.add(host)
      try {
        // Find the full SSH config entry for this host
        const config = sshConfigs.find(c => c.host === host)
        if (!config) {
          message.error(t('terminal:failedToConnect', { host, error: 'SSH config not found for ' + host }))
          return
        }
        await attemptSSHConnection(config, session.id, false, false)
      } catch (error: any) {
        console.error('Failed to connect SSH:', error)
        const parsedError = parseSSHConnectError(error)
        message.error(t('terminal:failedToConnect', { host, error: parsedError.message }))
      } finally {
        connectingHostsRef.current.delete(host)
      }
      return
    }

    // local
    try {
      const sessionId = await CreateLocalTerminalSession()
      setSessions(prev => prev.map(s =>
        s.id === session.id
          ? { ...s, id: sessionId, connected: true, name: s.customName || t('terminal:localTerminal') }
          : s
      ))
      setActiveSessionId(sessionId)
    } catch (error) {
      console.error('Failed to create local terminal:', error)
      message.error(t('terminal:failedToCreateLocalSession'))
    }
  }, [attemptSSHConnection, t, sshConfigs])

  // Connect on tab activation (lazy connect)
  useEffect(() => {
    if (!activeSessionId) return
    const s = sessions.find(ss => ss.id === activeSessionId)
    if (!s) return
    if (s.connected) return
    connectSessionIfNeeded(s)
  }, [activeSessionId, sessions, connectSessionIfNeeded])

  const handleCreateSession = async (config: SSHConfigEntry) => {
    // Guard: prevent rapid duplicate connections to the same host
    if (connectingHostsRef.current.has(config.host)) {
      console.log(`⚠️ Connection to ${config.host} already in progress, ignoring duplicate click`)
      return
    }
    if (authPrompt.visible && authPrompt.config?.host === config.host) {
      return
    }
    connectingHostsRef.current.add(config.host)
    
    // Create a temporary session ID for tracking
    const tempSessionId = `temp-${config.host}-${Date.now()}`
    
    try {
      // Add a pending session first
      const pendingSession: Session = {
        tabId: createTabId(),
        id: tempSessionId,
        name: config.host,
        connected: false,
        type: 'ssh',
        sshHost: config.host  // Store SSH host for reconnection
      }
      setSessions(prev => [...prev, pendingSession])
      setActiveSessionId(tempSessionId)
      
      // Try to connect
      const connected = await attemptSSHConnection(config, tempSessionId, true, true)
      if (!connected) {
        return
      }
    } catch (error: any) {
      console.error('Failed to create session:', error)
      const parsedError = parseSSHConnectError(error)
      message.error(t('terminal:failedToConnect', { host: config.host, error: parsedError.message }))
      removeSessionPlaceholder(tempSessionId)
    } finally {
      // Release the guard after connection attempt completes
      connectingHostsRef.current.delete(config.host)
    }
  }

  const handleAuthPromptCancel = useCallback(() => {
    if (authPrompt.removeSessionOnCancel && authPrompt.sessionRefId) {
      removeSessionPlaceholder(authPrompt.sessionRefId)
    }
    closeAuthPrompt()
  }, [authPrompt.removeSessionOnCancel, authPrompt.sessionRefId, closeAuthPrompt, removeSessionPlaceholder])

  const handleAuthPromptSubmit = useCallback(async () => {
    if (!authPrompt.config || !authPrompt.sessionRefId) {
      return
    }

    if (!authInput) {
      setAuthPrompt(prev => ({
        ...prev,
        errorMessage: authPrompt.kind === 'password'
          ? t('terminal:sshPasswordEmpty')
          : t('terminal:sshKeyPassphraseEmpty'),
      }))
      return
    }

    setAuthPrompt(prev => ({
      ...prev,
      submitting: true,
      errorMessage: '',
    }))

    try {
      const sessionId = await ConnectSSHWithAuth(
        authPrompt.config,
        authPrompt.kind === 'password' ? authInput : '',
        authPrompt.kind === 'password' ? authPrompt.host : '',
        authPrompt.kind === 'key_passphrase' ? authInput : '',
        authPrompt.kind === 'key_passphrase' ? authPrompt.identityFile : '',
      )
      finalizeSSHConnection(authPrompt.sessionRefId, sessionId, authPrompt.config.host, authPrompt.showSuccessToast)
      closeAuthPrompt()
    } catch (error: any) {
      console.error('Failed to continue SSH authentication:', error)
      const parsedError = parseSSHConnectError(error)
      if (parsedError.kind === 'password_required' || parsedError.kind === 'key_passphrase_required') {
        showAuthPromptForError(
          parsedError,
          authPrompt.config,
          authPrompt.sessionRefId,
          authPrompt.removeSessionOnCancel,
          authPrompt.showSuccessToast,
        )
        return
      }

      setAuthPrompt(prev => ({
        ...prev,
        submitting: false,
        errorMessage:
          parsedError.kind === 'password_invalid'
            ? t('terminal:sshPasswordInvalid')
            : parsedError.kind === 'key_passphrase_invalid'
              ? t('terminal:sshKeyPassphraseInvalid')
              : parsedError.message,
      }))
      if (parsedError.kind === 'password_invalid' || parsedError.kind === 'key_passphrase_invalid') {
        setAuthInput('')
      }
      return
    }

    setAuthPrompt(prev => ({
      ...prev,
      submitting: false,
    }))
  }, [authInput, authPrompt, closeAuthPrompt, finalizeSSHConnection, showAuthPromptForError, t])

  const handleClearPasswordCache = useCallback(async () => {
    try {
      await ClearSSHPasswordCache()
      message.success(t('terminal:clearedPasswordCache'))
    } catch (error: any) {
      console.error('Failed to clear SSH password cache:', error)
      message.error(t('terminal:clearPasswordCacheFailed', { error: getErrorMessage(error) }))
    }
  }, [t])

  const handleCreateLocalTerminal = async () => {
    try {
      // Create local terminal session
      const sessionId = await CreateLocalTerminalSession()
      
      // Get current directory for initialDir
      let initialDir = ''
      try {
        initialDir = await GetHomeDirectory()
      } catch (e) {
        console.warn('Failed to get home directory:', e)
      }
      
      const newSession: Session = {
        tabId: createTabId(),
        id: sessionId,
        name: t('terminal:localTerminal'),
        connected: true,
        type: 'local',
        initialDir
      }
      setSessions([...sessions, newSession])
      setActiveSessionId(sessionId)
    } catch (error) {
      console.error('Failed to create local terminal:', error)
      message.error(t('terminal:failedToCreateLocalSession'))
    }
  }

  const handleEditSSHConfig = async () => {
    try {
      const homeDir = await GetHomeDirectory()
      const configPath = `${homeDir}/.ssh/config`
      await OpenEditorWindow(configPath, false, '')
      message.success(t('terminal:openedSSHConfig'))
    } catch (error: any) {
      console.error('Failed to open SSH config:', error)
      message.error(t('terminal:failedToOpenSSHConfig'))
    }
  }

  // Create a local terminal at a specific path (triggered from file browser)
  const handleCreateLocalTerminalAtPath = async (dirPath: string) => {
    try {
      // Create local terminal session
      const sessionId = await CreateLocalTerminalSession()
      const newSession: Session = {
        tabId: createTabId(),
        id: sessionId,
        name: `Terminal - ${dirPath.split('/').pop() || 'Local'}`,
        connected: true,
        type: 'local',
        initialDir: dirPath  // Store the initial directory
      }
      setSessions(prev => [...prev, newSession])
      setActiveSessionId(sessionId)
    } catch (error) {
      console.error('Failed to create local terminal:', error)
      message.error(t('terminal:failedToCreateLocalSession'))
    }
  }

  // Handle tab double-click to rename
  const handleTabDoubleClick = (session: Session) => {
    setRenamingSessionId(session.id)
    setRenameValue(session.customName || session.name)
    // Focus input after state update
    setTimeout(() => {
      if (renameInputRef.current) {
        renameInputRef.current.focus()
        renameInputRef.current.select()
      }
    }, 0)
  }

  // Confirm rename
  const handleRenameConfirm = () => {
    if (!renamingSessionId || !renameValue.trim()) {
      setRenamingSessionId(null)
      return
    }

    setSessions(prev => prev.map(s =>
      s.id === renamingSessionId
        ? { ...s, customName: renameValue.trim() }
        : s
    ))

    setRenamingSessionId(null)
    setRenameValue('')
  }

  // Cancel rename
  const handleRenameCancel = () => {
    setRenamingSessionId(null)
    setRenameValue('')
  }

  const togglePane = useCallback((pane: CollapsiblePane) => {
    setCollapsedPanes(prev => ({
      ...prev,
      [pane]: !prev[pane],
    }))
  }, [])

  const getCollapsedPaneStyle = useCallback((isCollapsed: boolean, width: number) => {
    if (isCollapsed) {
      return {
        flexGrow: 0,
        flexShrink: 0,
        flexBasis: '44px',
        width: '44px',
        minWidth: '44px',
        maxWidth: '44px',
      }
    }

    return {
      flexGrow: width,
      flexShrink: 1,
      flexBasis: 0,
    }
  }, [])

  const getTerminalPaneWidth = useCallback((sessionType: Session['type']) => {
    if (sessionType === 'local') {
      return paneWidths.terminal +
        paneWidths.commands +
        paneWidths.remote +
        (collapsedPanes.local ? paneWidths.local : 0)
    }

    return paneWidths.terminal +
      (collapsedPanes.commands ? paneWidths.commands : 0) +
      (collapsedPanes.remote ? paneWidths.remote : 0) +
      (collapsedPanes.local ? paneWidths.local : 0)
  }, [collapsedPanes, paneWidths])

  const handleCloseSession = (sessionId: string) => {
    const closedSession = sessions.find(s => s.id === sessionId)
    
    // Only clean up backend resources if this session is actually connected
    if (closedSession?.connected) {
      CloseTerminalSession(sessionId).catch((err) => {
        console.error('Failed to close terminal session:', err)
      })
      if (closedSession.type === 'ssh') {
        DisconnectSSH(sessionId).catch(console.error)
      }
    }
    
    // Update React state + persist immediately (avoid losing state if app closes quickly)
    const remainingSessions = sessions.filter(s => s.id !== sessionId)
    const nextActiveSessionId =
      activeSessionId === sessionId
        ? (remainingSessions.length > 0 ? remainingSessions[0].id : null)
        : activeSessionId

    setSessions(remainingSessions)
    setActiveSessionId(nextActiveSessionId)
    persistSessions(remainingSessions, nextActiveSessionId)

    if (closedSession) {
      clearTerminalHistory(closedSession.tabId)
    }
  }

  // --- Tab context menu handlers ---
  const handleTabContextMenu = useCallback((e: React.MouseEvent, sessionId: string, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    setTabContextMenu({ visible: true, x: e.clientX, y: e.clientY, sessionId, index })
  }, [])

  // Dismiss tab context menu on any click
  useEffect(() => {
    if (!tabContextMenu.visible) return
    const dismiss = () => setTabContextMenu(prev => ({ ...prev, visible: false }))
    document.addEventListener('click', dismiss)
    return () => document.removeEventListener('click', dismiss)
  }, [tabContextMenu.visible])

  // Batch close: clean up backend resources for removed sessions, then update state once
  const batchCloseSessions = useCallback((keepFilter: (s: Session, index: number) => boolean) => {
    const remaining = sessions.filter(keepFilter)
    const toClose = sessions.filter((s, i) => !keepFilter(s, i))

    // Clean up backend for each closed session
    toClose.forEach(s => {
      if (s.connected) {
        CloseTerminalSession(s.id).catch(err => console.error('Failed to close terminal session:', err))
        if (s.type === 'ssh') {
          DisconnectSSH(s.id).catch(console.error)
        }
      }
    })

    // Decide next active tab
    const remainingIds = new Set(remaining.map(s => s.id))
    const nextActive = activeSessionId && remainingIds.has(activeSessionId)
      ? activeSessionId
      : (remaining.length > 0 ? remaining[0].id : null)

    setSessions(remaining)
    setActiveSessionId(nextActive)
    persistSessions(remaining, nextActive)
    toClose.forEach(s => clearTerminalHistory(s.tabId))
  }, [sessions, activeSessionId, persistSessions])

  const handleCloseCurrentTab = useCallback(() => {
    if (tabContextMenu.sessionId) {
      handleCloseSession(tabContextMenu.sessionId)
    }
    setTabContextMenu(prev => ({ ...prev, visible: false }))
  }, [tabContextMenu.sessionId, sessions, activeSessionId])

  const handleCloseTabsToLeft = useCallback(() => {
    const idx = tabContextMenu.index
    batchCloseSessions((_s, i) => i >= idx)
    setTabContextMenu(prev => ({ ...prev, visible: false }))
  }, [tabContextMenu.index, batchCloseSessions])

  const handleCloseTabsToRight = useCallback(() => {
    const idx = tabContextMenu.index
    batchCloseSessions((_s, i) => i <= idx)
    setTabContextMenu(prev => ({ ...prev, visible: false }))
  }, [tabContextMenu.index, batchCloseSessions])

  const handleCloseOtherTabs = useCallback(() => {
    const keepId = tabContextMenu.sessionId
    batchCloseSessions((s) => s.id === keepId)
    setTabContextMenu(prev => ({ ...prev, visible: false }))
  }, [tabContextMenu.sessionId, batchCloseSessions])

  const handleContextMenuRename = useCallback(() => {
    const session = sessions.find(s => s.id === tabContextMenu.sessionId)
    if (session) {
      handleTabDoubleClick(session)
    }
    setTabContextMenu(prev => ({ ...prev, visible: false }))
  }, [tabContextMenu.sessionId, sessions])

  // Draggable divider logic
  const handleMouseDown = useCallback((leftPane: PaneKey, rightPane: PaneKey, e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = { leftPane, rightPane }
    startXRef.current = e.clientX
    startWidthsRef.current = { ...paneWidths }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [paneWidths])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingRef.current === null || !containerRef.current) return

      const containerWidth = containerRef.current.getBoundingClientRect().width
      const deltaX = e.clientX - startXRef.current
      const deltaPercent = (deltaX / containerWidth) * 100

      const { leftPane, rightPane } = draggingRef.current
      const newWidths: PaneWidths = { ...startWidthsRef.current }
      const minWidth = 12

      newWidths[leftPane] = startWidthsRef.current[leftPane] + deltaPercent
      newWidths[rightPane] = startWidthsRef.current[rightPane] - deltaPercent

      if (newWidths[leftPane] >= minWidth && newWidths[rightPane] >= minWidth) {
        setPaneWidths(newWidths)
      }
    }

    const handleMouseUp = () => {
      if (draggingRef.current !== null) {
        draggingRef.current = null
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // SFTP transfer handlers
  const handleDownloadToLocal = async (remotePath: string, localDir: string) => {
    if (!activeSessionId) return
    
    try {
      message.loading({ content: t('terminal:downloading', { path: remotePath }), key: 'transfer', duration: 0 })
      const result = await DownloadFile(activeSessionId, remotePath, localDir)
      message.success({ content: t('terminal:downloadedTo', { path: result }), key: 'transfer' })
      setLocalRefreshKey(k => k + 1)
    } catch (err: any) {
      message.error({ content: t('terminal:downloadFailed', { error: err?.message || err }), key: 'transfer' })
    }
  }

  const handleUploadToRemote = async (localPath: string, remoteDir: string) => {
    if (!activeSessionId) return
    
    try {
      message.loading({ content: t('terminal:uploading', { path: localPath }), key: 'transfer', duration: 0 })
      const result = await UploadFile(activeSessionId, localPath, remoteDir)
      message.success({ content: t('terminal:uploadedTo', { path: result }), key: 'transfer' })
      setRemoteRefreshKey(k => k + 1)
    } catch (err: any) {
      message.error({ content: t('terminal:uploadFailed', { error: err?.message || err }), key: 'transfer' })
    }
  }

  const filteredConfigs = sshConfigs.filter(config =>
    config.host.toLowerCase().includes(searchText.toLowerCase())
  )

  const persistServerOrder = useCallback(async (
    nextConfigs: SSHConfigEntry[],
    successMessage?: string,
  ) => {
    if (haveSameSSHConfigOrder(persistedSSHConfigsRef.current, nextConfigs)) {
      return true
    }

    const previousConfigs = persistedSSHConfigsRef.current
    setSshConfigs(nextConfigs)
    setSavingServerOrder(true)

    try {
      const sshConfigContent = await ReadLocalFile('~/.ssh/config')
      const reorderedConfig = reorderSSHConfigContent(
        sshConfigContent,
        nextConfigs.map((config) => config.host),
      )

      if (reorderedConfig.matchedBlockCount < 2) {
        throw new Error(t('terminal:serverOrderUnavailable'))
      }

      if (reorderedConfig.changed) {
        await WriteLocalFile('~/.ssh/config', reorderedConfig.content)
      }

      persistedSSHConfigsRef.current = nextConfigs

      if (successMessage) {
        message.success(successMessage)
      }
      return true
    } catch (error: any) {
      console.error('Failed to persist SSH server order:', error)
      setSshConfigs(previousConfigs)
      message.error(t('terminal:failedToSaveServerOrder', { error: getErrorMessage(error) }))
      return false
    } finally {
      setSavingServerOrder(false)
    }
  }, [t])

  const handleSortServers = useCallback(async (direction: 'asc' | 'desc') => {
    if (savingServerOrder || sshConfigs.length < 2) {
      return
    }

    const nextConfigs = sortSSHConfigsByName(sshConfigs, direction)
    if (haveSameSSHConfigOrder(sshConfigs, nextConfigs)) {
      return
    }

    await persistServerOrder(
      nextConfigs,
      direction === 'asc' ? t('terminal:serversSortedAsc') : t('terminal:serversSortedDesc'),
    )
  }, [persistServerOrder, savingServerOrder, sshConfigs, t])

  const handleServerItemClick = useCallback((config: SSHConfigEntry) => {
    if (suppressServerClickRef.current) {
      suppressServerClickRef.current = false
      return
    }

    handleCreateSession(config)
  }, [handleCreateSession])

  const handleServerDragStart = useCallback((event: React.DragEvent, host: string) => {
    if (savingServerOrder) {
      event.preventDefault()
      return
    }

    setDraggedServerHost(host)
    serverOrderChangedRef.current = false
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', host)

    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.style.opacity = '0.5'
    }
  }, [savingServerOrder])

  const handleServerDragOver = useCallback((event: React.DragEvent, targetHost: string) => {
    if (!draggedServerHost || draggedServerHost === targetHost || savingServerOrder) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'

    setSshConfigs((prev) => {
      const visibleHosts = prev
        .filter((config) => config.host.toLowerCase().includes(searchText.toLowerCase()))
        .map((config) => config.host)
      const next = reorderSSHConfigsByVisibleHosts(prev, draggedServerHost, targetHost, visibleHosts)

      if (!haveSameSSHConfigOrder(prev, next)) {
        serverOrderChangedRef.current = true
      }

      return next
    })
  }, [draggedServerHost, savingServerOrder, searchText])

  const handleServerDragEnd = useCallback(async (event: React.DragEvent) => {
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.style.opacity = '1'
    }

    const orderChanged = serverOrderChangedRef.current
    serverOrderChangedRef.current = false
    setDraggedServerHost(null)

    if (!orderChanged) {
      return
    }

    suppressServerClickRef.current = true
    await persistServerOrder(sshConfigs, t('terminal:serverOrderSaved'))
  }, [persistServerOrder, sshConfigs, t])

  // Check if a server has an active session
  const isServerConnected = (host: string): boolean => {
    return sessions.some(session => session.name === host && session.connected && session.type === 'ssh')
  }

  // Listen for global clear-drag event from App (Wails OnFileDrop bypasses browser onDrop)
  useEffect(() => {
    const clearDragHandler = () => {
      setIsDraggingFile(false)
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current)
      }
    }
    window.addEventListener('app:clear-drag-state', clearDragHandler)
    return () => window.removeEventListener('app:clear-drag-state', clearDragHandler)
  }, [])

  // Listen for terminal open requests from file browser
  useEffect(() => {
    const handler = (e: Event) => {
      const path = (e as CustomEvent).detail?.path as string
      if (path) {
        handleCreateLocalTerminalAtPath(path)
      }
    }
    window.addEventListener('app:open-terminal-at-path', handler)
    return () => window.removeEventListener('app:open-terminal-at-path', handler)
  }, [])

  // Listen for file drop events from App (Wails OnFileDrop for OS-level drag)
  useEffect(() => {
    const handler = (e: Event) => {
      const paths = (e as CustomEvent).detail?.paths as string[]
      console.log('📥 [TerminalTab] File drop received, paths:', paths)

      if (!paths || paths.length === 0) {
        console.warn('⚠️ [TerminalTab] No paths received in drop event')
        return
      }

      // Check if there's an active terminal session
      if (!activeSessionId) {
        console.warn('⚠️ [TerminalTab] No active terminal session to write paths')
        message.warning(t('terminal:noActiveSession'))
        return
      }

      // Escape paths and join with spaces
      const escapedPaths = escapeShellPaths(paths)
      console.log('✅ [TerminalTab] Writing escaped paths to terminal:', escapedPaths)

      // Write the escaped paths to the active terminal
      WriteToTerminal(activeSessionId, escapedPaths).catch((err) => {
        console.error('❌ [TerminalTab] Failed to write file paths to terminal:', err)
        message.error(t('terminal:failedToWritePaths'))
      })
    }

    window.addEventListener('app:file-drop-terminal', handler)
    return () => window.removeEventListener('app:file-drop-terminal', handler)
  }, [activeSessionId, t])

  // In-app file drag: use dragover to track position + show overlay,
  // and use dragend (NOT drop) to execute the action.
  //
  // WHY NOT drop? Wails sets DisableWebViewDrop:true which causes the native
  // WKWebView to intercept ALL drops. The JS 'drop' event NEVER fires.
  //
  // Strategy:
  //   1. dragover (capture on Content) → detect zone (terminal / local-fm / remote-fm),
  //      call setDragTarget(), show overlay if over terminal.
  //   2. dragend (on window, capture) → read payload + target, dispatch action:
  //      - terminal:  write escaped path to terminal
  //      - local-fm:  download remote file to local dir (remote→local)
  //      - remote-fm: upload local file to remote dir (local→remote)

  useEffect(() => {
    const el = contentEl
    if (!el) {
      dlog('[Term] contentEl is null, skip drag setup')
      return
    }
    dlog('[Term] Setting up drag listeners (dragover+dragend strategy)')

    let dragOverCount = 0

    const onDragOver = (e: DragEvent) => {
      const payload = getDragPayload()
      if (!payload) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'

      // Detect which zone the cursor is over
      const target = document.elementFromPoint(e.clientX, e.clientY)
      if (target) {
        if (target.closest('.terminal-pane') || target.closest('.terminal-container') || target.closest('.terminal-drop-overlay')) {
          setDragTarget('terminal')
        } else if (target.closest('.local-file-manager')) {
          setDragTarget('local-fm')
        } else if (target.closest('.file-manager-container')) {
          setDragTarget('remote-fm')
        }
      }

      // Show overlay only when over terminal
      const isOverTerminal = getDragTarget() === 'terminal'
      setIsDraggingFile(isOverTerminal)

      dragOverCount++
      if (dragOverCount === 1) {
        dlog('[Term] onDragOver FIRST hit, payload=' + payload.path)
      }
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current)
      dragTimeoutRef.current = setTimeout(() => setIsDraggingFile(false), 3000)
    }

    const onDragLeave = (e: DragEvent) => {
      if (!getDragPayload()) return
      const rect = el.getBoundingClientRect()
      const { clientX: x, clientY: y } = e
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
        dlog('[Term] onDragLeave - left Content area')
        clearDragTarget()
        setIsDraggingFile(false)
        if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current)
      }
    }

    // dragend fires on the drag SOURCE element when the user releases the mouse.
    // This is our only chance to act since 'drop' never fires in Wails WKWebView.
    const onDragEnd = (e: DragEvent) => {
      // Force clear overlay
      dlog('[Term] dragend: clearing isDraggingFile')
      setIsDraggingFile(false)
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current)
      dragTimeoutRef.current = null
      dragOverCount = 0

      const payload = getDragPayload()
      const target = getDragTarget()
      clearDragPayload()
      clearDragTarget()

      dlog('[Term] dragend: target=' + target + ' payload=' + JSON.stringify(payload))

      if (!payload?.path || !target) return

      const sid = activeSessionIdRef.current
      dlog('[Term] dragend: activeSessionId=' + sid)

      if (target === 'terminal') {
        // Write path to terminal
        if (!sid) return
        const escapedPaths = escapeShellPaths([payload.path])
        dlog('[Term] dragend: writing to terminal: ' + escapedPaths)
        WriteToTerminal(sid, escapedPaths).catch((err) => {
          dlog('[Term] dragend: write FAILED: ' + err)
        })
      } else if (target === 'local-fm' && payload.source === 'remote') {
        // Download remote file to local directory
        if (!sid) return
        // Find the local file manager's current path from DOM data attribute
        const localFmEl = document.querySelector('.local-file-manager[data-current-path]')
        const localDir = localFmEl?.getAttribute('data-current-path') || ''
        dlog('[Term] dragend: download ' + payload.path + ' -> ' + localDir)
        if (localDir) {
          DownloadFile(sid, payload.path, localDir).then((result) => {
            message.success(t('terminal:downloadedTo', { path: result }))
            setLocalRefreshKey(k => k + 1)
          }).catch((err: any) => {
            message.error(t('terminal:downloadFailed', { error: err?.message || err }))
            dlog('[Term] dragend: download FAILED: ' + err)
          })
        }
      } else if (target === 'remote-fm' && payload.source === 'local') {
        // Upload local file to remote directory
        if (!sid) return
        const remoteFmEl = document.querySelector('.file-manager-container[data-current-path]')
        const remoteDir = remoteFmEl?.getAttribute('data-current-path') || ''
        dlog('[Term] dragend: upload ' + payload.path + ' -> ' + remoteDir)
        if (remoteDir) {
          UploadFile(sid, payload.path, remoteDir).then((result) => {
            message.success(t('terminal:uploadedTo', { path: result }))
            setRemoteRefreshKey(k => k + 1)
          }).catch((err: any) => {
            message.error(t('terminal:uploadFailed', { error: err?.message || err }))
            dlog('[Term] dragend: upload FAILED: ' + err)
          })
        }
      } else {
        dlog('[Term] dragend: no valid action for source=' + payload.source + ' target=' + target)
      }
    }

    el.addEventListener('dragover', onDragOver, true)
    el.addEventListener('dragleave', onDragLeave, true)
    window.addEventListener('dragend', onDragEnd, true)

    return () => {
      el.removeEventListener('dragover', onDragOver, true)
      el.removeEventListener('dragleave', onDragLeave, true)
      window.removeEventListener('dragend', onDragEnd, true)
    }
  }, [contentEl])

  // Tab drag handlers for reordering
  const handleTabDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDraggedTabIndex(index)
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', index.toString())
    
    // Set drag image opacity
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5'
    }
  }, [])

  const handleTabDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    
    if (draggedTabIndex === null || draggedTabIndex === index) return
    
    // Reorder sessions array
    const newSessions = [...sessions]
    const [draggedSession] = newSessions.splice(draggedTabIndex, 1)
    newSessions.splice(index, 0, draggedSession)
    setSessions(newSessions)
    setDraggedTabIndex(index)
  }, [draggedTabIndex, sessions])

  const handleTabDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1'
    }
    setDraggedTabIndex(null)
  }, [])

  return (
    <Layout className="terminal-tab-container">
      <Sider
        width={250}
        collapsed={sidebarCollapsed}
        collapsedWidth={0}
        theme="dark"
        className="terminal-sidebar"
      >
        <div className="sidebar-header">
          {!sidebarCollapsed && (
            <>
              <Input
                placeholder={t('terminal:searchServers')}
                prefix={<SearchOutlined />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="server-search"
              />
              <div className="server-order-toolbar">
                <div className="server-order-actions">
                  <Tooltip title={t('terminal:sortServersAsc')}>
                    <Button
                      size="small"
                      icon={<SortAscendingOutlined />}
                      onClick={() => { void handleSortServers('asc') }}
                      disabled={loading || savingServerOrder || sshConfigs.length < 2}
                      className="server-order-btn"
                    >
                      {t('terminal:sortServersAsc')}
                    </Button>
                  </Tooltip>
                  <Tooltip title={t('terminal:sortServersDesc')}>
                    <Button
                      size="small"
                      icon={<SortDescendingOutlined />}
                      onClick={() => { void handleSortServers('desc') }}
                      disabled={loading || savingServerOrder || sshConfigs.length < 2}
                      className="server-order-btn"
                    >
                      {t('terminal:sortServersDesc')}
                    </Button>
                  </Tooltip>
                </div>
                <div className="server-order-hint">
                  {t('terminal:serverOrderHint')}
                </div>
              </div>
              <Button
                type="primary"
                icon={<EditOutlined />}
                onClick={handleEditSSHConfig}
                block
                className="edit-config-btn"
              >
                {t('terminal:editSSHConfig')}
              </Button>
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleCreateLocalTerminal}
                block
                className="local-terminal-btn"
              >
                {t('terminal:localTerminal')}
              </Button>
              <Button
                danger
                onClick={handleClearPasswordCache}
                block
                className="clear-password-cache-btn"
              >
                {t('terminal:clearPasswordCache')}
              </Button>
            </>
          )}
        </div>
        {!sidebarCollapsed && (
          <div className="server-list">
            {loading ? (
              <Spin />
            ) : (
              <List
                dataSource={filteredConfigs}
                renderItem={(config) => {
                  const isConnected = isServerConnected(config.host)
                  return (
                    <List.Item
                      className={`server-item ${draggedServerHost === config.host ? 'dragging' : ''}`}
                      draggable={!savingServerOrder}
                      onDragStart={(event) => handleServerDragStart(event, config.host)}
                      onDragOver={(event) => handleServerDragOver(event, config.host)}
                      onDragEnd={(event) => { void handleServerDragEnd(event) }}
                      onClick={() => handleServerItemClick(config)}
                    >
                      <span className="server-drag-handle" aria-hidden="true">
                        <MenuOutlined />
                      </span>
                      <span 
                        className="server-status" 
                        style={{ color: isConnected ? '#52c41a' : '#888' }}
                      >
                        ●
                      </span>
                      <List.Item.Meta
                        title={config.host}
                        description={config.hostname || config.user}
                      />
                    </List.Item>
                  )
                }}
              />
            )}
          </div>
        )}
      </Sider>
      <Content 
        ref={contentRefCb}
        className={`terminal-content ${isDraggingFile ? 'dragging-file' : ''}`}
      >
        {isDraggingFile && (
          <div className="terminal-drop-overlay">
            <div className="terminal-drop-message">
              <span style={{ fontSize: 48 }}>📄</span>
              <p>{t('terminal:dropFilesToInsertPath')}</p>
            </div>
          </div>
        )}
        {sessions.length === 0 ? (
          <div className="empty-state">
            <p>{t('terminal:noActiveSessions')}</p>
            <p className="empty-hint">{t('terminal:clickServerToConnect')}</p>
          </div>
        ) : (
          <div className="session-tabs">
            {sessions.map((session, index) => (
              <div
                key={session.tabId}
                className={`session-tab ${activeSessionId === session.id ? 'active' : ''}`}
                draggable={true}
                onDragStart={(e) => handleTabDragStart(e, index)}
                onDragOver={(e) => handleTabDragOver(e, index)}
                onDragEnd={handleTabDragEnd}
                onClick={() => setActiveSessionId(session.id)}
                onDoubleClick={() => handleTabDoubleClick(session)}
                onContextMenu={(e) => handleTabContextMenu(e, session.id, index)}
              >
                <span className="session-status" style={{ color: session.connected ? '#52c41a' : '#ff4d4f' }}>
                  ●
                </span>
                {renamingSessionId === session.id ? (
                  <Input
                    ref={renameInputRef}
                    className="session-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onPressEnter={handleRenameConfirm}
                    onBlur={handleRenameConfirm}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        handleRenameCancel()
                      }
                      e.stopPropagation()
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="session-name">{session.customName || session.name}</span>
                )}
                <CloseOutlined
                  className="session-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCloseSession(session.id)
                  }}
                />
              </div>
            ))}
          </div>
        )}
        {/* Render all sessions but only show the active one - keeps SSH connections alive */}
        <div className="session-view" ref={containerRef}>
          {sessions.length === 0 ? (
            <div className="empty-state">
              <p>{t('terminal:noActiveSessions')}</p>
              <p className="empty-hint">{t('terminal:clickServerToConnect')}</p>
            </div>
          ) : (
            sessions.map((session) => {
              const isActive = session.id === activeSessionId
              const sshHost = session.sshHost || session.name
              const sshConfig = sshConfigs.find(c => c.host === sshHost)
              const terminalPaneWidth = getTerminalPaneWidth(session.type)
            
            // For local terminal: show Terminal + Local Files (2 panes)
            if (session.type === 'local') {
              return (
                <div 
                  key={session.tabId}
                  className={`session-split-pane ${isActive ? 'session-active' : ''}`}
                >
                  {/* Terminal Pane */}
                  <div 
                    className="terminal-pane"
                    style={{ 
                      flexGrow: terminalPaneWidth, 
                      flexShrink: 1, 
                      flexBasis: 0 
                    }}
                  >
                    <div className="pane-header">
                      <span className="pane-title">{t('common:terminal')}</span>
                      <span className="pane-info">{t('terminal:localTerminal')}</span>
                    </div>
                    <div className="pane-content">
                      <Terminal
                        sessionId={session.id}
                        historyKey={session.tabId}
                        sessionType={session.type}
                        isActive={isActive}
                        connected={session.connected}
                        enableSelectToCopy={terminalSettings.enableSelectToCopy}
                        enableRightClickPaste={terminalSettings.enableRightClickPaste}
                        initialDir={session.initialDir}
                      />
                    </div>
                  </div>

                  {/* Divider */}
                  {!collapsedPanes.local && (
                    <div 
                      className="split-divider"
                      onMouseDown={(e) => handleMouseDown('terminal', 'local', e)}
                    />
                  )}

                  {/* Local Files Pane */}
                  <div 
                    className={`local-files-pane ${collapsedPanes.local ? 'pane-collapsed' : ''}`}
                    style={getCollapsedPaneStyle(collapsedPanes.local, paneWidths.local)}
                  >
                    <div className={`pane-header ${collapsedPanes.local ? 'pane-header-collapsed' : ''}`}>
                      <span className={`pane-title ${collapsedPanes.local ? 'pane-title-collapsed' : ''}`}>
                        {t('terminal:localFiles')}
                      </span>
                      {!collapsedPanes.local && (
                        <span className="pane-info">{t('terminal:localhost')}</span>
                      )}
                      <Button
                        type="text"
                        size="small"
                        className="pane-toggle-btn"
                        icon={collapsedPanes.local ? <LeftOutlined /> : <RightOutlined />}
                        title={collapsedPanes.local ? t('common:expand') : t('common:collapse')}
                        onClick={() => togglePane('local')}
                      />
                    </div>
                    <div className={`pane-content ${collapsedPanes.local ? 'pane-content-hidden' : ''}`}>
                      <LocalFileManager
                        onUploadFile={handleUploadToRemote}
                        onDownloadComplete={() => setLocalRefreshKey(k => k + 1)}
                        sessionId={session.id}
                        refreshKey={localRefreshKey}
                      />
                    </div>
                  </div>
                </div>
              )
            }
            
            // For SSH terminal: show Terminal + Commands + Remote Files + Local Files (4 panes)
            return (
              <div 
                key={session.tabId}
                className={`session-split-pane ${isActive ? 'session-active' : ''}`}
              >
                {/* Terminal Pane */}
                <div 
                  className="terminal-pane"
                  style={{ 
                    flexGrow: terminalPaneWidth, 
                    flexShrink: 1, 
                    flexBasis: 0 
                  }}
                >
                  <div className="pane-header">
                    <span className="pane-title">{t('common:terminal')}</span>
                    <span className="pane-info">{sshHost}</span>
                  </div>
                   <div className="pane-content">
                     <Terminal
                       sessionId={session.id}
                       historyKey={session.tabId}
                       sessionType={session.type}
                       isActive={isActive}
                       connected={session.connected}
                       enableSelectToCopy={terminalSettings.enableSelectToCopy}
                       enableRightClickPaste={terminalSettings.enableRightClickPaste}
                       initialDir={session.initialDir}
                     />
                   </div>
                </div>

                {/* Divider 1 */}
                {!collapsedPanes.commands && (
                  <div 
                    className="split-divider"
                    onMouseDown={(e) => handleMouseDown('terminal', 'commands', e)}
                  />
                )}

                {/* Command Pane */}
                <div 
                  className={`command-pane ${collapsedPanes.commands ? 'pane-collapsed' : ''}`}
                  style={getCollapsedPaneStyle(collapsedPanes.commands, paneWidths.commands)}
                >
                  <div className={`pane-header ${collapsedPanes.commands ? 'pane-header-collapsed' : ''}`}>
                    <span className={`pane-title ${collapsedPanes.commands ? 'pane-title-collapsed' : ''}`}>
                      {t('terminal:commandPanelTitle')}
                    </span>
                    {!collapsedPanes.commands && (
                      <span className="pane-info">{t('terminal:commandPanelInfo')}</span>
                    )}
                    <Button
                      type="text"
                      size="small"
                      className="pane-toggle-btn"
                      icon={collapsedPanes.commands ? <LeftOutlined /> : <RightOutlined />}
                      title={collapsedPanes.commands ? t('common:expand') : t('common:collapse')}
                      onClick={() => togglePane('commands')}
                    />
                  </div>
                  <div className={`pane-content ${collapsedPanes.commands ? 'pane-content-hidden' : ''}`}>
                    <CommandPanel
                      sessionId={session.id}
                      host={sshHost}
                      connected={session.connected}
                      isActive={isActive}
                    />
                  </div>
                </div>

                {/* Divider 2 */}
                {!collapsedPanes.commands && !collapsedPanes.remote && (
                  <div 
                    className="split-divider"
                    onMouseDown={(e) => handleMouseDown('commands', 'remote', e)}
                  />
                )}

                {/* Remote Files Pane */}
                <div 
                  className={`file-manager-pane ${collapsedPanes.remote ? 'pane-collapsed' : ''}`}
                  style={getCollapsedPaneStyle(collapsedPanes.remote, paneWidths.remote)}
                >
                  <div className={`pane-header ${collapsedPanes.remote ? 'pane-header-collapsed' : ''}`}>
                    <span className={`pane-title ${collapsedPanes.remote ? 'pane-title-collapsed' : ''}`}>
                      {t('terminal:remoteFiles')}
                    </span>
                    {!collapsedPanes.remote && (
                      <span className="pane-info">{sshHost}</span>
                    )}
                    <Button
                      type="text"
                      size="small"
                      className="pane-toggle-btn"
                      icon={collapsedPanes.remote ? <LeftOutlined /> : <RightOutlined />}
                      title={collapsedPanes.remote ? t('common:expand') : t('common:collapse')}
                      onClick={() => togglePane('remote')}
                    />
                  </div>
                  <div className={`pane-content ${collapsedPanes.remote ? 'pane-content-hidden' : ''}`}>
                    {sshConfig && session.connected ? (
                      <FileManager
                        connection={sshConfig}
                        sessionId={session.id}
                        onPathChange={() => {}}
                        onDownloadFile={handleDownloadToLocal}
                        refreshKey={remoteRefreshKey}
                      />
                    ) : (
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        height: '100%',
                        color: '#888'
                      }}>
                        {session.connected ? t('terminal:noSSHConfig') : t('terminal:connecting')}
                      </div>
                    )}
                  </div>
                </div>

                {/* Divider 3 */}
                {!collapsedPanes.local && (
                  <div 
                    className="split-divider"
                    onMouseDown={(e) => handleMouseDown('remote', 'local', e)}
                  />
                )}

                {/* Local Files Pane */}
                <div 
                  className={`local-files-pane ${collapsedPanes.local ? 'pane-collapsed' : ''}`}
                  style={getCollapsedPaneStyle(collapsedPanes.local, paneWidths.local)}
                >
                  <div className={`pane-header ${collapsedPanes.local ? 'pane-header-collapsed' : ''}`}>
                    <span className={`pane-title ${collapsedPanes.local ? 'pane-title-collapsed' : ''}`}>
                      {t('terminal:localFiles')}
                    </span>
                    {!collapsedPanes.local && (
                      <span className="pane-info">{t('terminal:localhost')}</span>
                    )}
                    <Button
                      type="text"
                      size="small"
                      className="pane-toggle-btn"
                      icon={collapsedPanes.local ? <LeftOutlined /> : <RightOutlined />}
                      title={collapsedPanes.local ? t('common:expand') : t('common:collapse')}
                      onClick={() => togglePane('local')}
                    />
                  </div>
                  <div className={`pane-content ${collapsedPanes.local ? 'pane-content-hidden' : ''}`}>
                    {session.connected ? (
                      <LocalFileManager
                        onUploadFile={handleUploadToRemote}
                        onDownloadComplete={() => setLocalRefreshKey(k => k + 1)}
                        sessionId={session.id}
                        refreshKey={localRefreshKey}
                      />
                    ) : (
                      <div style={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center', 
                        height: '100%',
                        color: '#888'
                      }}>
                        {t('terminal:connecting')}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })
          )}
        </div>
        {/* Tab context menu (right-click) */}
        {tabContextMenu.visible && (
          <div
            className="tab-context-menu"
            style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tab-context-menu-item" onClick={handleCloseCurrentTab}>
              <CloseOutlined /> <span>{t('common:closeCurrent')}</span>
            </div>
            <div className="tab-context-menu-divider" />
            <div
              className={`tab-context-menu-item ${tabContextMenu.index === 0 ? 'disabled' : ''}`}
              onClick={tabContextMenu.index > 0 ? handleCloseTabsToLeft : undefined}
            >
              <span>{t('common:closeToLeft')}</span>
            </div>
            <div
              className={`tab-context-menu-item ${tabContextMenu.index >= sessions.length - 1 ? 'disabled' : ''}`}
              onClick={tabContextMenu.index < sessions.length - 1 ? handleCloseTabsToRight : undefined}
            >
              <span>{t('common:closeToRight')}</span>
            </div>
            <div
              className={`tab-context-menu-item ${sessions.length <= 1 ? 'disabled' : ''}`}
              onClick={sessions.length > 1 ? handleCloseOtherTabs : undefined}
            >
              <span>{t('common:closeOthers')}</span>
            </div>
            <div className="tab-context-menu-divider" />
            <div className="tab-context-menu-item" onClick={handleContextMenuRename}>
              <EditOutlined /> <span>{t('common:rename')}</span>
            </div>
          </div>
        )}
        <Modal
          open={authPrompt.visible}
          title={
            authPrompt.kind === 'password'
              ? t('terminal:sshPasswordPromptTitle', { host: authPrompt.host || authPrompt.config?.host || '' })
              : t('terminal:sshKeyPassphrasePromptTitle', { host: authPrompt.host || authPrompt.config?.host || '' })
          }
          onCancel={authPrompt.submitting ? undefined : handleAuthPromptCancel}
          maskClosable={!authPrompt.submitting}
          closable={!authPrompt.submitting}
          footer={[
            <Button key="cancel" onClick={handleAuthPromptCancel} disabled={authPrompt.submitting}>
              {t('common:cancel')}
            </Button>,
            <Button key="connect" type="primary" loading={authPrompt.submitting} onClick={handleAuthPromptSubmit}>
              {authPrompt.kind === 'password'
                ? t('terminal:connectWithPassword')
                : t('terminal:unlockPrivateKey')}
            </Button>,
          ]}
        >
          <p className="ssh-password-hint">
            {authPrompt.kind === 'password'
              ? (
                authPrompt.reasonCode === 'cached_invalid'
                  ? t('terminal:sshPasswordPromptDescriptionCached', { host: authPrompt.host || authPrompt.config?.host || '' })
                  : t('terminal:sshPasswordPromptDescription', { host: authPrompt.host || authPrompt.config?.host || '' })
              )
              : (
                authPrompt.reasonCode === 'cached_invalid'
                  ? t('terminal:sshKeyPassphrasePromptDescriptionCached', {
                    host: authPrompt.host || authPrompt.config?.host || '',
                    identity: authPrompt.identityFile.split('/').pop() || authPrompt.identityFile,
                  })
                  : t('terminal:sshKeyPassphrasePromptDescription', {
                    host: authPrompt.host || authPrompt.config?.host || '',
                    identity: authPrompt.identityFile.split('/').pop() || authPrompt.identityFile,
                  })
              )}
          </p>
          <Input.Password
            autoFocus
            value={authInput}
            placeholder={
              authPrompt.kind === 'password'
                ? t('terminal:sshPasswordPlaceholder')
                : t('terminal:sshKeyPassphrasePlaceholder')
            }
            onChange={(e) => setAuthInput(e.target.value)}
            onPressEnter={handleAuthPromptSubmit}
            disabled={authPrompt.submitting}
          />
          {authPrompt.errorMessage && (
            <div className="ssh-password-error">
              {authPrompt.errorMessage}
            </div>
          )}
        </Modal>
      </Content>
    </Layout>
  )
}

export default TerminalTab
