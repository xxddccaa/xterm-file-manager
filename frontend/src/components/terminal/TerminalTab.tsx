import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Layout, Input, Button, List, Spin, message } from 'antd'
import { SearchOutlined, PlusOutlined, CloseOutlined, EditOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { main } from '../../../wailsjs/go/models'
type SSHConfigEntry = main.SSHConfigEntry
import { ConnectSSH, CreateLocalTerminalSession, GetSSHConfig, GetTerminalSettings, DisconnectSSH, DownloadFile, UploadFile, WriteToTerminal, CloseTerminalSession, OpenEditorWindow, GetHomeDirectory, SaveTerminalSessions, LoadTerminalSessions } from '../../../wailsjs/go/app/App'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import Terminal from './Terminal'
import FileManager from '../file-manager/FileManager'
import LocalFileManager from '../file-manager/LocalFileManager'
import { escapeShellPaths } from '../../utils/shellEscape'
import { getDragPayload, clearDragPayload, setDragTarget, clearDragTarget, getDragTarget } from '../../utils/dragState'
import { dlog } from '../../utils/debugLog'
import './TerminalTab.css'

const { Sider, Content } = Layout

interface Session {
  id: string
  name: string
  customName?: string  // User-defined custom name (if renamed)
  connected: boolean
  type: 'ssh' | 'local'
  initialDir?: string  // Optional initial directory for local terminals
  sshHost?: string  // SSH config host name for reconnection
}

interface PersistedSession {
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

const TerminalTab: React.FC = () => {
  const { t } = useTranslation(['terminal', 'common'])
  const [sshConfigs, setSshConfigs] = useState<SSHConfigEntry[]>([])
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
  
  // Pane widths for resizable dividers
  // Terminal gets more space (50%), file managers get less (25% each)
  const [paneWidths, setPaneWidths] = useState<[number, number, number]>([50, 25, 25])
  const containerRef = useRef<HTMLDivElement>(null)
  const draggingRef = useRef<number | null>(null)
  const startXRef = useRef(0)
  const startWidthsRef = useRef<[number, number, number]>([50, 25, 25])
  
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
      setSshConfigs(configs || [])
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
        return {
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
        const sessionId = await ConnectSSH(config)
        setSessions(prev => prev.map(s =>
          s.id === session.id
            ? { ...s, id: sessionId, connected: true, sshHost: host, name: s.customName || host }
            : s
        ))
        setActiveSessionId(sessionId)
      } catch (error: any) {
        console.error('Failed to connect SSH:', error)
        message.error(t('terminal:failedToConnect', { host, error: error?.message || error }))
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
  }, [t, sshConfigs])

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
    connectingHostsRef.current.add(config.host)
    
    // Create a temporary session ID for tracking
    const tempSessionId = `temp-${config.host}-${Date.now()}`
    
    try {
      // Add a pending session first
      const pendingSession: Session = {
        id: tempSessionId,
        name: config.host,
        connected: false,
        type: 'ssh',
        sshHost: config.host  // Store SSH host for reconnection
      }
      setSessions(prev => [...prev, pendingSession])
      setActiveSessionId(tempSessionId)
      
      // Try to connect
      const sessionId = await ConnectSSH(config)
      
      // Update session with real ID and connected status
      setSessions(prev => prev.map(s => 
        s.id === tempSessionId 
          ? { ...s, id: sessionId, connected: true }
          : s
      ))
      setActiveSessionId(sessionId)
      
      message.success(t('terminal:connectedToHost', { host: config.host }))
    } catch (error: any) {
      console.error('Failed to create session:', error)
      message.error(t('terminal:failedToConnect', { host: config.host, error: error?.message || error }))
      
      // Remove the failed session after a delay
      setTimeout(() => {
        setSessions(prev => prev.filter(s => s.id !== tempSessionId))
        if (activeSessionId === tempSessionId) {
          const remaining = sessions.filter(s => s.id !== tempSessionId)
          setActiveSessionId(remaining.length > 0 ? remaining[0].id : null)
        }
      }, 3000)
    } finally {
      // Release the guard after connection attempt completes
      connectingHostsRef.current.delete(config.host)
    }
  }

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
  const handleMouseDown = useCallback((dividerIndex: number, e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = dividerIndex
    startXRef.current = e.clientX
    startWidthsRef.current = [...paneWidths] as [number, number, number]
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [paneWidths])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingRef.current === null || !containerRef.current) return

      const containerWidth = containerRef.current.getBoundingClientRect().width
      const deltaX = e.clientX - startXRef.current
      const deltaPercent = (deltaX / containerWidth) * 100

      const newWidths: [number, number, number] = [...startWidthsRef.current] as [number, number, number]
      const divider = draggingRef.current
      const minWidth = 15

      if (divider === 0) {
        newWidths[0] = startWidthsRef.current[0] + deltaPercent
        newWidths[1] = startWidthsRef.current[1] - deltaPercent
      } else {
        newWidths[1] = startWidthsRef.current[1] + deltaPercent
        newWidths[2] = startWidthsRef.current[2] - deltaPercent
      }

      if (newWidths[0] >= minWidth && newWidths[1] >= minWidth && newWidths[2] >= minWidth) {
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
                      className="server-item"
                      onClick={() => handleCreateSession(config)}
                    >
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
                key={session.id}
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
              const sshConfig = sshConfigs.find(c => c.host === session.name)
            
            // For local terminal: show Terminal + Local Files (2 panes)
            if (session.type === 'local') {
              return (
                <div 
                  key={session.id}
                  className={`session-split-pane ${isActive ? 'session-active' : ''}`}
                >
                  {/* Terminal Pane */}
                  <div 
                    className="terminal-pane"
                    style={{ 
                      flexGrow: paneWidths[0] + paneWidths[1], 
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
                        sessionType={session.type}
                        isActive={isActive}
                        enableSelectToCopy={terminalSettings.enableSelectToCopy}
                        enableRightClickPaste={terminalSettings.enableRightClickPaste}
                        initialDir={session.initialDir}
                      />
                    </div>
                  </div>

                  {/* Divider */}
                  <div 
                    className="split-divider"
                    onMouseDown={(e) => handleMouseDown(0, e)}
                  />

                  {/* Local Files Pane */}
                  <div 
                    className="local-files-pane"
                    style={{ 
                      flexGrow: paneWidths[2], 
                      flexShrink: 1, 
                      flexBasis: 0 
                    }}
                  >
                    <div className="pane-header">
                      <span className="pane-title">{t('terminal:localFiles')}</span>
                      <span className="pane-info">{t('terminal:localhost')}</span>
                    </div>
                    <div className="pane-content">
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
            
            // For SSH terminal: show Terminal + Remote Files + Local Files (3 panes)
            return (
              <div 
                key={session.id}
                className={`session-split-pane ${isActive ? 'session-active' : ''}`}
              >
                {/* Terminal Pane */}
                <div 
                  className="terminal-pane"
                  style={{ 
                    flexGrow: paneWidths[0], 
                    flexShrink: 1, 
                    flexBasis: 0 
                  }}
                >
                  <div className="pane-header">
                    <span className="pane-title">{t('common:terminal')}</span>
                    <span className="pane-info">{session.name}</span>
                  </div>
                   <div className="pane-content">
                     <Terminal
                       sessionId={session.id}
                       sessionType={session.type}
                       isActive={isActive}
                       enableSelectToCopy={terminalSettings.enableSelectToCopy}
                       enableRightClickPaste={terminalSettings.enableRightClickPaste}
                       initialDir={session.initialDir}
                     />
                   </div>
                </div>

                {/* Divider 1 */}
                <div 
                  className="split-divider"
                  onMouseDown={(e) => handleMouseDown(0, e)}
                />

                {/* Remote Files Pane */}
                <div 
                  className="file-manager-pane"
                  style={{ 
                    flexGrow: paneWidths[1], 
                    flexShrink: 1, 
                    flexBasis: 0 
                  }}
                >
                  <div className="pane-header">
                    <span className="pane-title">{t('terminal:remoteFiles')}</span>
                    <span className="pane-info">{session.name}</span>
                  </div>
                  <div className="pane-content">
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

                {/* Divider 2 */}
                <div 
                  className="split-divider"
                  onMouseDown={(e) => handleMouseDown(1, e)}
                />

                {/* Local Files Pane */}
                <div 
                  className="local-files-pane"
                  style={{ 
                    flexGrow: paneWidths[2], 
                    flexShrink: 1, 
                    flexBasis: 0 
                  }}
                >
                  <div className="pane-header">
                    <span className="pane-title">{t('terminal:localFiles')}</span>
                    <span className="pane-info">{t('terminal:localhost')}</span>
                  </div>
                  <div className="pane-content">
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
      </Content>
    </Layout>
  )
}

export default TerminalTab
