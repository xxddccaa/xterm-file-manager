import React, { useState, useEffect, useRef, useCallback } from 'react'
import { Button, message, Spin, Modal } from 'antd'
import { SaveOutlined, CloseOutlined, FullscreenOutlined, FullscreenExitOutlined } from '@ant-design/icons'
import Editor from '@monaco-editor/react'
import { ReadLocalFile, WriteLocalFile, ReadRemoteFile, WriteRemoteFile } from '../../../wailsjs/go/app/App'
import './CodeEditor.css'

interface CodeEditorProps {
  visible: boolean
  filePath: string
  isRemote: boolean
  sessionId?: string
  onClose: () => void
  onSaved?: () => void
}

interface Position {
  x: number
  y: number
}

interface Size {
  width: number
  height: number
}

const MIN_WIDTH = 400
const MIN_HEIGHT = 300

const CodeEditor: React.FC<CodeEditorProps> = ({
  visible,
  filePath,
  isRemote,
  sessionId,
  onClose,
  onSaved,
}) => {
  const [content, setContent] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [modified, setModified] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const editorRef = useRef<any>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  
  // Position and size state
  const [position, setPosition] = useState<Position>({ x: 0, y: 0 })
  const [size, setSize] = useState<Size>({ width: 0, height: 0 })
  const [preMaxState, setPreMaxState] = useState<{ pos: Position; size: Size } | null>(null)
  
  // Drag state
  const isDragging = useRef(false)
  const dragOffset = useRef<Position>({ x: 0, y: 0 })
  
  // Resize state
  const isResizing = useRef(false)
  const resizeDir = useRef<string>('')
  const resizeStart = useRef<{ x: number; y: number; w: number; h: number; px: number; py: number }>({
    x: 0, y: 0, w: 0, h: 0, px: 0, py: 0
  })

  // Center the panel when first shown
  useEffect(() => {
    if (visible) {
      const vw = window.innerWidth
      const vh = window.innerHeight
      const w = Math.min(Math.round(vw * 0.75), 1200)
      const h = Math.min(Math.round(vh * 0.8), 900)
      setSize({ width: w, height: h })
      setPosition({
        x: Math.round((vw - w) / 2),
        y: Math.round((vh - h) / 2),
      })
      setMaximized(false)
      setPreMaxState(null)
    }
  }, [visible, filePath])

  // Detect language from file extension
  const getLanguage = (path: string): string => {
    const ext = path.split('.').pop()?.toLowerCase()
    const languageMap: { [key: string]: string } = {
      'js': 'javascript',
      'jsx': 'javascript',
      'ts': 'typescript',
      'tsx': 'typescript',
      'json': 'json',
      'py': 'python',
      'go': 'go',
      'rs': 'rust',
      'java': 'java',
      'c': 'c',
      'cpp': 'cpp',
      'cc': 'cpp',
      'cxx': 'cpp',
      'h': 'c',
      'hpp': 'cpp',
      'cs': 'csharp',
      'php': 'php',
      'rb': 'ruby',
      'sh': 'shell',
      'bash': 'shell',
      'zsh': 'shell',
      'fish': 'shell',
      'sql': 'sql',
      'html': 'html',
      'htm': 'html',
      'xml': 'xml',
      'css': 'css',
      'scss': 'scss',
      'sass': 'sass',
      'less': 'less',
      'md': 'markdown',
      'yaml': 'yaml',
      'yml': 'yaml',
      'toml': 'toml',
      'ini': 'ini',
      'conf': 'ini',
      'txt': 'plaintext',
    }
    return languageMap[ext || ''] || 'plaintext'
  }

  // Load file content
  useEffect(() => {
    if (visible && filePath) {
      loadFile()
    }
  }, [visible, filePath, isRemote, sessionId])

  const loadFile = async () => {
    setLoading(true)
    try {
      let fileContent: string
      if (isRemote && sessionId) {
        fileContent = await ReadRemoteFile(sessionId, filePath)
      } else {
        fileContent = await ReadLocalFile(filePath)
      }
      setContent(fileContent)
      setModified(false)
    } catch (err: any) {
      message.error(`Failed to load file: ${err?.message || err}`)
      console.error('Failed to load file:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async () => {
    if (!editorRef.current) return

    setSaving(true)
    try {
      const currentContent = editorRef.current.getValue()
      if (isRemote && sessionId) {
        await WriteRemoteFile(sessionId, filePath, currentContent)
        message.success('File saved to remote server')
      } else {
        await WriteLocalFile(filePath, currentContent)
        message.success('File saved locally')
      }
      setContent(currentContent)
      setModified(false)
      onSaved?.()
    } catch (err: any) {
      message.error(`Failed to save file: ${err?.message || err}`)
      console.error('Failed to save file:', err)
    } finally {
      setSaving(false)
    }
  }

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined && value !== content) {
      setModified(true)
    }
  }

  const handleClose = () => {
    if (modified) {
      Modal.confirm({
        title: 'Unsaved Changes',
        content: 'You have unsaved changes. Are you sure you want to close?',
        okText: 'Close Without Saving',
        okType: 'danger',
        cancelText: 'Cancel',
        onOk: () => {
          setModified(false)
          onClose()
        },
      })
    } else {
      onClose()
    }
  }

  const handleEditorMount = (editor: any) => {
    editorRef.current = editor
    // Add Cmd+S / Ctrl+S keyboard shortcut for save
    editor.addCommand(
      // Monaco.KeyMod.CtrlCmd | Monaco.KeyCode.KeyS
      2048 | 49, // Ctrl/Cmd + S
      () => {
        handleSave()
      }
    )
  }

  const getFileName = () => {
    return filePath.split('/').pop() || filePath
  }

  // ===== Drag handlers =====
  const handleDragStart = useCallback((e: React.MouseEvent) => {
    if (maximized) return
    // Only drag from title bar, not buttons
    if ((e.target as HTMLElement).closest('.floating-panel-btn')) return
    isDragging.current = true
    dragOffset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    }
    e.preventDefault()
  }, [position, maximized])

  const handleMouseMove = useCallback((e: MouseEvent) => {
    if (isDragging.current) {
      const newX = e.clientX - dragOffset.current.x
      const newY = e.clientY - dragOffset.current.y
      // Clamp so title bar stays visible
      setPosition({
        x: Math.max(-size.width + 100, Math.min(newX, window.innerWidth - 100)),
        y: Math.max(0, Math.min(newY, window.innerHeight - 40)),
      })
    }
    if (isResizing.current) {
      const s = resizeStart.current
      const dir = resizeDir.current
      let newW = s.w
      let newH = s.h
      let newX = s.px
      let newY = s.py
      
      if (dir.includes('e')) newW = Math.max(MIN_WIDTH, s.w + (e.clientX - s.x))
      if (dir.includes('s')) newH = Math.max(MIN_HEIGHT, s.h + (e.clientY - s.y))
      if (dir.includes('w')) {
        const dw = e.clientX - s.x
        newW = Math.max(MIN_WIDTH, s.w - dw)
        if (newW > MIN_WIDTH) newX = s.px + dw
      }
      if (dir.includes('n')) {
        const dh = e.clientY - s.y
        newH = Math.max(MIN_HEIGHT, s.h - dh)
        if (newH > MIN_HEIGHT) newY = s.py + dh
      }
      
      setSize({ width: newW, height: newH })
      setPosition({ x: newX, y: newY })
    }
  }, [])

  const handleMouseUp = useCallback(() => {
    isDragging.current = false
    isResizing.current = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  useEffect(() => {
    if (visible) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [visible, handleMouseMove, handleMouseUp])

  // ===== Resize handlers =====
  const handleResizeStart = useCallback((dir: string) => (e: React.MouseEvent) => {
    if (maximized) return
    isResizing.current = true
    resizeDir.current = dir
    resizeStart.current = {
      x: e.clientX,
      y: e.clientY,
      w: size.width,
      h: size.height,
      px: position.x,
      py: position.y,
    }
    document.body.style.userSelect = 'none'
    e.preventDefault()
    e.stopPropagation()
  }, [size, position, maximized])

  // ===== Maximize/Restore =====
  const toggleMaximize = () => {
    if (maximized) {
      // Restore
      if (preMaxState) {
        setPosition(preMaxState.pos)
        setSize(preMaxState.size)
      }
      setMaximized(false)
    } else {
      // Save current state and maximize
      setPreMaxState({ pos: { ...position }, size: { ...size } })
      setPosition({ x: 0, y: 0 })
      setSize({ width: window.innerWidth, height: window.innerHeight })
      setMaximized(true)
    }
  }

  // Double-click title bar to toggle maximize
  const handleTitleDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.floating-panel-btn')) return
    toggleMaximize()
  }

  if (!visible) return null

  const panelStyle: React.CSSProperties = maximized
    ? { left: 0, top: 0, width: '100vw', height: '100vh', borderRadius: 0 }
    : { left: position.x, top: position.y, width: size.width, height: size.height }

  return (
    <div className="floating-panel" style={panelStyle} ref={panelRef}>
        {/* Resize handles */}
        {!maximized && (
          <>
            <div className="resize-handle resize-n" onMouseDown={handleResizeStart('n')} />
            <div className="resize-handle resize-s" onMouseDown={handleResizeStart('s')} />
            <div className="resize-handle resize-e" onMouseDown={handleResizeStart('e')} />
            <div className="resize-handle resize-w" onMouseDown={handleResizeStart('w')} />
            <div className="resize-handle resize-ne" onMouseDown={handleResizeStart('ne')} />
            <div className="resize-handle resize-nw" onMouseDown={handleResizeStart('nw')} />
            <div className="resize-handle resize-se" onMouseDown={handleResizeStart('se')} />
            <div className="resize-handle resize-sw" onMouseDown={handleResizeStart('sw')} />
          </>
        )}

        {/* Title bar - draggable */}
        <div
          className="floating-panel-titlebar"
          onMouseDown={handleDragStart}
          onDoubleClick={handleTitleDoubleClick}
        >
          <div className="floating-panel-title">
            <span className="editor-filename">
              {getFileName()} {modified && <span className="editor-modified-dot">●</span>}
            </span>
            <span className="editor-filepath">{filePath}</span>
          </div>
          <div className="floating-panel-actions">
            <Button
              className="floating-panel-btn"
              type="text"
              size="small"
              icon={<SaveOutlined />}
              loading={saving}
              disabled={!modified}
              onClick={handleSave}
              title="Save (Cmd+S)"
            />
            <Button
              className="floating-panel-btn"
              type="text"
              size="small"
              icon={maximized ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
              onClick={toggleMaximize}
              title={maximized ? 'Restore' : 'Maximize'}
            />
            <Button
              className="floating-panel-btn floating-panel-close"
              type="text"
              size="small"
              icon={<CloseOutlined />}
              onClick={handleClose}
              title="Close"
            />
          </div>
        </div>

        {/* Editor body */}
        <div className="floating-panel-body">
          {loading ? (
            <div className="editor-loading">
              <Spin size="large" />
              <p>Loading file...</p>
            </div>
          ) : (
            <Editor
              height="100%"
              language={getLanguage(filePath)}
              value={content}
              onChange={handleEditorChange}
              onMount={handleEditorMount}
              theme="vs-dark"
              options={{
                minimap: { enabled: true },
                fontSize: 14,
                lineNumbers: 'on',
                rulers: [80, 120],
                wordWrap: 'off',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                tabSize: 2,
                insertSpaces: true,
              }}
            />
          )}
        </div>

        {/* Status bar */}
        <div className="floating-panel-statusbar">
          <span className="statusbar-info">
            {isRemote ? '🌐 Remote' : '💻 Local'}
            {modified ? ' • Modified' : ''}
          </span>
          <span className="statusbar-lang">{getLanguage(filePath)}</span>
        </div>
      </div>
  )
}

export default CodeEditor
