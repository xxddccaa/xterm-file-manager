import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Layout, Input, Button, List, Spin, message } from 'antd'
import { SearchOutlined, PlusOutlined, CloseOutlined } from '@ant-design/icons'
import { main } from '../../../wailsjs/go/models'
type SSHConfigEntry = main.SSHConfigEntry
import { ConnectSSH, CreateLocalTerminalSession, GetSSHConfig, GetTerminalSettings } from '../../../wailsjs/go/app/App'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import Terminal from './Terminal'
import FileManager from '../file-manager/FileManager'
import LocalFileManager from '../file-manager/LocalFileManager'
import './TerminalTab.css'

const { Sider, Content } = Layout

interface Session {
  id: string
  name: string
  connected: boolean
  type: 'ssh' | 'local'
}

interface TerminalSettings {
  enableSelectToCopy: boolean
  enableRightClickPaste: boolean
}

const TerminalTab: React.FC = () => {
  const [sshConfigs, setSshConfigs] = useState<SSHConfigEntry[]>([])
  const [searchText, setSearchText] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
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

  useEffect(() => {
    loadSSHConfig()
    loadTerminalSettings()
    
    // Listen for settings changes
    const cleanup = EventsOn('terminal:settings-changed', (settings: TerminalSettings) => {
      setTerminalSettings(settings)
    })
    
    return cleanup
  }, [])

  const loadSSHConfig = async () => {
    try {
      const configs = await GetSSHConfig()
      setSshConfigs(configs || [])
    } catch (error) {
      console.error('Failed to load SSH config:', error)
      message.error('Failed to load SSH configuration')
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
      
      message.success(`Connected to ${config.host}`)
    } catch (error: any) {
      console.error('Failed to create session:', error)
      message.error(`Failed to connect to ${config.host}: ${error?.message || error}`)
      
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
      const newSession: Session = {
        id: sessionId,
        name: 'Local Terminal',
        connected: true,
        type: 'local',
      }
      setSessions([...sessions, newSession])
      setActiveSessionId(sessionId)
    } catch (error) {
      console.error('Failed to create local terminal:', error)
      message.error('Failed to create local terminal session')
    }
  }

  const handleCloseSession = (sessionId: string) => {
    // Note: SSH connections are now cleaned up in the backend when tab is explicitly closed
    // This prevents accidental disconnection when switching tabs
    const remainingSessions = sessions.filter(s => s.id !== sessionId)
    setSessions(remainingSessions)
    if (activeSessionId === sessionId) {
      setActiveSessionId(remainingSessions.length > 0 ? remainingSessions[0].id : null)
    }
    
    // Explicitly disconnect SSH session when closing tab
    const closedSession = sessions.find(s => s.id === sessionId)
    if (closedSession && closedSession.type === 'ssh') {
      if ((window as any).go?.app?.App?.DisconnectSSH) {
        (window as any).go.app.App.DisconnectSSH(sessionId).catch(console.error)
      }
    }
  }

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
      message.loading({ content: `Downloading ${remotePath}...`, key: 'transfer', duration: 0 })
      if ((window as any).go?.app?.App?.DownloadFile) {
        const result = await (window as any).go.app.App.DownloadFile(activeSessionId, remotePath, localDir)
        message.success({ content: `Downloaded to ${result}`, key: 'transfer' })
        setLocalRefreshKey(k => k + 1)
      }
    } catch (err: any) {
      message.error({ content: `Download failed: ${err?.message || err}`, key: 'transfer' })
    }
  }

  const handleUploadToRemote = async (localPath: string, remoteDir: string) => {
    if (!activeSessionId) return
    
    try {
      message.loading({ content: `Uploading ${localPath}...`, key: 'transfer', duration: 0 })
      if ((window as any).go?.app?.App?.UploadFile) {
        const result = await (window as any).go.app.App.UploadFile(activeSessionId, localPath, remoteDir)
        message.success({ content: `Uploaded to ${result}`, key: 'transfer' })
        setRemoteRefreshKey(k => k + 1)
      }
    } catch (err: any) {
      message.error({ content: `Upload failed: ${err?.message || err}`, key: 'transfer' })
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

  // Drag and drop visual handlers (prevent browser default + show overlay)
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingFile(true)
    // Safety: auto-clear overlay after 3s in case drop event is lost
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current)
    dragTimeoutRef.current = setTimeout(() => setIsDraggingFile(false), 3000)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const { clientX: x, clientY: y } = e
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDraggingFile(false)
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDraggingFile(false)
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current)
    // Actual file path writing is handled by App-level OnFileDrop -> Terminal component
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
                placeholder="Search servers..."
                prefix={<SearchOutlined />}
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="server-search"
              />
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={handleCreateLocalTerminal}
                block
                className="local-terminal-btn"
              >
                Local Terminal
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
        className={`terminal-content ${isDraggingFile ? 'dragging-file' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {isDraggingFile && (
          <div className="terminal-drop-overlay">
            <div className="terminal-drop-message">
              <span style={{ fontSize: 48 }}>📄</span>
              <p>Drop files to insert path into terminal</p>
            </div>
          </div>
        )}
        {sessions.length === 0 ? (
          <div className="empty-state">
            <p>No active sessions</p>
            <p className="empty-hint">Click a server from the sidebar to create a session</p>
          </div>
        ) : (
          <div className="session-tabs">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`session-tab ${activeSessionId === session.id ? 'active' : ''}`}
                onClick={() => setActiveSessionId(session.id)}
              >
                <span className="session-status" style={{ color: session.connected ? '#52c41a' : '#ff4d4f' }}>
                  ●
                </span>
                <span className="session-name">{session.name}</span>
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
              <p>No active sessions</p>
              <p className="empty-hint">Click a server from the sidebar to create a session</p>
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
                      <span className="pane-title">Terminal</span>
                      <span className="pane-info">Local Terminal</span>
                    </div>
                    <div className="pane-content">
                      <Terminal
                        sessionId={session.id}
                        sessionType={session.type}
                        isActive={isActive}
                        enableSelectToCopy={terminalSettings.enableSelectToCopy}
                        enableRightClickPaste={terminalSettings.enableRightClickPaste}
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
                      <span className="pane-title">Local Files</span>
                      <span className="pane-info">localhost</span>
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
                    <span className="pane-title">Terminal</span>
                    <span className="pane-info">{session.name}</span>
                  </div>
                  <div className="pane-content">
                    <Terminal
                      sessionId={session.id}
                      sessionType={session.type}
                      isActive={isActive}
                      enableSelectToCopy={terminalSettings.enableSelectToCopy}
                      enableRightClickPaste={terminalSettings.enableRightClickPaste}
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
                    <span className="pane-title">Remote Files</span>
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
                        {session.connected ? 'No SSH config' : 'Connecting...'}
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
                    <span className="pane-title">Local Files</span>
                    <span className="pane-info">localhost</span>
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
                        Connecting...
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })
          )}
        </div>
      </Content>
    </Layout>
  )
}

export default TerminalTab
