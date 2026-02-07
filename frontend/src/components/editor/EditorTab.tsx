import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Button, message, Modal, Input, Dropdown } from 'antd'
import { PlusOutlined, SaveOutlined, CloseOutlined, FileOutlined, FolderOpenOutlined, EllipsisOutlined } from '@ant-design/icons'
import Editor from '@monaco-editor/react'
import { ReadLocalFile, WriteLocalFile, CreateLocalFile, GetDefaultEditorDirectory, GetNextUntitledFileName, OpenFileDialog } from '../../../wailsjs/go/app/App'
import './EditorTab.css'

interface EditorFile {
  id: string
  path: string
  name: string
  content: string
  modified: boolean
  language: string
  isNew: boolean
}

// Detect language from file extension
const getLanguage = (path: string): string => {
  const ext = path.split('.').pop()?.toLowerCase()
  const languageMap: { [key: string]: string } = {
    'js': 'javascript', 'jsx': 'javascript', 'ts': 'typescript', 'tsx': 'typescript',
    'json': 'json', 'py': 'python', 'go': 'go', 'rs': 'rust', 'java': 'java',
    'c': 'c', 'cpp': 'cpp', 'cc': 'cpp', 'cxx': 'cpp', 'h': 'c', 'hpp': 'cpp',
    'cs': 'csharp', 'php': 'php', 'rb': 'ruby', 'sh': 'shell', 'bash': 'shell',
    'zsh': 'shell', 'fish': 'shell', 'sql': 'sql', 'html': 'html', 'htm': 'html',
    'xml': 'xml', 'css': 'css', 'scss': 'scss', 'sass': 'sass', 'less': 'less',
    'md': 'markdown', 'yaml': 'yaml', 'yml': 'yaml', 'toml': 'toml', 'ini': 'ini',
    'conf': 'ini', 'txt': 'plaintext',
  }
  return languageMap[ext || ''] || 'plaintext'
}

// Get file name from path
const getFileName = (path: string): string => {
  if (!path) return 'Untitled'
  return path.split('/').pop() || path
}

const EditorTab: React.FC = () => {
  const [files, setFiles] = useState<EditorFile[]>([])
  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [saveAsModalVisible, setSaveAsModalVisible] = useState(false)
  const [saveAsPath, setSaveAsPath] = useState('')
  const [defaultDirectory, setDefaultDirectory] = useState('')
  const editorRefs = useRef<{ [key: string]: any }>({})
  const fileCounterRef = useRef(1)
  const tabBarRef = useRef<HTMLDivElement>(null)

  // Use a ref to always have access to the latest files state (avoids stale closure)
  const filesRef = useRef<EditorFile[]>([])
  filesRef.current = files

  // Load default directory on mount
  useEffect(() => {
    const loadDefaultDir = async () => {
      try {
        const dir = await GetDefaultEditorDirectory()
        setDefaultDirectory(dir)
        console.log('Default editor directory:', dir)
      } catch (err) {
        console.error('Failed to get default directory:', err)
      }
    }
    loadDefaultDir()
  }, [])

  // Open file from path (uses ref to avoid stale closure)
  const openFileFromPath = useCallback(async (filePath: string) => {
    // Check if file is already open using ref (latest state)
    const currentFiles = filesRef.current
    const existingFile = currentFiles.find(f => f.path === filePath)
    if (existingFile) {
      setActiveFileId(existingFile.id)
      message.info('File is already open')
      return
    }

    try {
      const content = await ReadLocalFile(filePath)
      const newFile: EditorFile = {
        id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        path: filePath,
        name: getFileName(filePath),
        content,
        modified: false,
        language: getLanguage(filePath),
        isNew: false,
      }
      // Prepend so the newest file is always the first (leftmost) tab
      setFiles(prev => [newFile, ...prev])
      setActiveFileId(newFile.id)
      // Scroll tab bar to start to reveal the new first tab
      setTimeout(() => { if (tabBarRef.current) tabBarRef.current.scrollLeft = 0 }, 0)
      message.success(`Opened: ${newFile.name}`)
    } catch (err: any) {
      message.error(`Failed to open file: ${err?.message || err}`)
      console.error('Failed to open file:', filePath, err)
    }
  }, [])

  // Listen for global clear-drag event from App (Wails OnFileDrop bypasses browser onDrop)
  useEffect(() => {
    const clearDragHandler = () => {
      setIsDragging(false)
      if (dragTimeoutRef.current) {
        clearTimeout(dragTimeoutRef.current)
      }
    }
    window.addEventListener('app:clear-drag-state', clearDragHandler)
    return () => window.removeEventListener('app:clear-drag-state', clearDragHandler)
  }, [])

  // Listen for file drop events dispatched from App-level OnFileDrop
  useEffect(() => {
    console.log('Setting up Editor file drop listener...')
    const handler = (e: Event) => {
      const paths = (e as CustomEvent).detail?.paths as string[]
      console.log('Editor file drop received, paths:', paths)

      if (!paths || paths.length === 0) {
        console.warn('No paths received in drop event')
        return
      }
      // Open each dropped file
      for (const filePath of paths) {
        console.log('Opening dropped file:', filePath)
        openFileFromPath(filePath)
      }
    }
    window.addEventListener('app:file-drop-editor', handler)

    return () => {
      console.log('Cleaning up Editor file drop listener')
      window.removeEventListener('app:file-drop-editor', handler)
    }
  }, [openFileFromPath])

  // Create new file
  const handleNewFile = async () => {
    const newFile: EditorFile = {
      id: `new-${Date.now()}`,
      path: '',
      name: `Untitled-${fileCounterRef.current++}`,
      content: '',
      modified: false,
      language: 'plaintext',
      isNew: true,
    }
    setFiles(prev => [newFile, ...prev])
    setActiveFileId(newFile.id)
    setTimeout(() => { if (tabBarRef.current) tabBarRef.current.scrollLeft = 0 }, 0)
  }

  // Open file dialog
  const handleOpenFileDialog = async () => {
    try {
      const filePath = await OpenFileDialog()
      if (filePath) {
        await openFileFromPath(filePath)
      }
    } catch (err: any) {
      console.error('Failed to open file dialog:', err)
      message.error(`Failed to open file: ${err?.message || err}`)
    }
  }

  // Save file
  const handleSave = async (fileId?: string) => {
    const targetId = fileId || activeFileId
    if (!targetId) return

    const file = files.find(f => f.id === targetId)
    if (!file) return

    const editor = editorRefs.current[targetId]
    if (!editor) return

    const currentContent = editor.getValue()

    // If it's a new file without path, show save as dialog
    if (file.isNew && !file.path) {
      try {
        if (defaultDirectory) {
          const defaultPath = await GetNextUntitledFileName(defaultDirectory)
          setSaveAsPath(defaultPath)
        } else {
          setSaveAsPath('')
        }
      } catch (err) {
        console.error('Failed to get default path:', err)
        setSaveAsPath('')
      }
      setSaveAsModalVisible(true)
      return
    }

    try {
      await WriteLocalFile(file.path, currentContent)
      setFiles(prev => prev.map(f =>
        f.id === targetId
          ? { ...f, content: currentContent, modified: false }
          : f
      ))
      message.success('File saved')
    } catch (err: any) {
      message.error(`Failed to save file: ${err?.message || err}`)
      console.error('Failed to save file:', err)
    }
  }

  // Save as (for new files)
  const handleSaveAs = async () => {
    if (!activeFileId) return

    const file = files.find(f => f.id === activeFileId)
    if (!file) return

    const editor = editorRefs.current[activeFileId]
    if (!editor) return

    const currentContent = editor.getValue()

    try {
      let finalPath = saveAsPath.trim()

      if (!finalPath) {
        if (!defaultDirectory) {
          message.error('Please enter a file path')
          return
        }
        finalPath = await GetNextUntitledFileName(defaultDirectory)
      }

      await CreateLocalFile(finalPath)
      await WriteLocalFile(finalPath, currentContent)

      setFiles(prev => prev.map(f =>
        f.id === activeFileId
          ? {
              ...f,
              path: finalPath,
              name: getFileName(finalPath),
              content: currentContent,
              modified: false,
              language: getLanguage(finalPath),
              isNew: false,
            }
          : f
      ))
      setSaveAsModalVisible(false)
      message.success(`File saved: ${getFileName(finalPath)}`)
    } catch (err: any) {
      message.error(`Failed to save file: ${err?.message || err}`)
      console.error('Failed to save file:', err)
    }
  }

  // Close file
  const handleCloseFile = (fileId: string) => {
    const file = files.find(f => f.id === fileId)
    if (!file) return

    if (file.modified) {
      Modal.confirm({
        title: 'Unsaved Changes',
        content: `${file.name} has unsaved changes. Close without saving?`,
        okText: 'Close Without Saving',
        okType: 'danger',
        cancelText: 'Cancel',
        onOk: () => {
          closeFileConfirmed(fileId)
        },
      })
    } else {
      closeFileConfirmed(fileId)
    }
  }

  const closeFileConfirmed = (fileId: string) => {
    setFiles(prev => {
      const idx = prev.findIndex(f => f.id === fileId)
      const newFiles = prev.filter(f => f.id !== fileId)
      // Update active file if we're closing the current one
      if (activeFileId === fileId) {
        // Select the tab that takes this position (keeps focus near the close button)
        const newActive = newFiles.length > 0
          ? newFiles[Math.min(idx, newFiles.length - 1)].id
          : null
        setTimeout(() => setActiveFileId(newActive), 0)
      }
      // Reset scroll when closing the first tab to keep close button position stable
      if (idx === 0 && tabBarRef.current) {
        setTimeout(() => {
          if (tabBarRef.current) tabBarRef.current.scrollLeft = 0
        }, 0)
      }
      return newFiles
    })
    delete editorRefs.current[fileId]
  }

  // Editor change handler
  const handleEditorChange = (value: string | undefined, fileId: string) => {
    if (value === undefined) return

    setFiles(prev => prev.map(f =>
      f.id === fileId ? { ...f, modified: value !== f.content || f.modified } : f
    ))
  }

  // Editor mount handler
  const handleEditorMount = (editor: any, fileId: string) => {
    editorRefs.current[fileId] = editor

    // Add Cmd+S / Ctrl+S keyboard shortcut for save
    editor.addCommand(
      2048 | 49, // Ctrl/Cmd + S
      () => {
        handleSave(fileId)
      }
    )
  }

  // Drag and drop visual handlers (overlay only; actual file handling via Wails OnFileDrop)
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
    // Safety: auto-clear overlay after 3s in case drop event is lost
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current)
    dragTimeoutRef.current = setTimeout(() => setIsDragging(false), 3000)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const { clientX: x, clientY: y } = e
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
      setIsDragging(false)
      if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (dragTimeoutRef.current) clearTimeout(dragTimeoutRef.current)
    // Actual file opening is handled by Wails OnFileDrop
  }, [])

  return (
    <div
      className={`editor-tab-container ${isDragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="drop-overlay">
          <div className="drop-message">
            <FileOutlined style={{ fontSize: 48 }} />
            <p>Drop files here to open</p>
          </div>
        </div>
      )}

      <div className="editor-toolbar">
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={handleNewFile}
          size="small"
        >
          New File
        </Button>
        <Button
          icon={<FolderOpenOutlined />}
          onClick={handleOpenFileDialog}
          size="small"
        >
          Open File
        </Button>
        {activeFileId && (
          <Button
            icon={<SaveOutlined />}
            onClick={() => handleSave()}
            size="small"
            disabled={!files.find(f => f.id === activeFileId)?.modified}
          >
            Save
          </Button>
        )}
      </div>

      {files.length === 0 ? (
        <div className="editor-empty-state">
          <FileOutlined style={{ fontSize: 64, color: '#888' }} />
          <p>No files open</p>
          <p className="editor-empty-hint">Create a new file or drag & drop files here</p>
        </div>
      ) : (
        <div className="editor-main">
          {/* Tab bar wrapper: scrollable tabs + fixed "..." button */}
          <div className="tab-bar-wrapper">
            <div className="custom-tab-bar" ref={tabBarRef}>
              {files.map((file) => (
                <div
                  key={file.id}
                  className={`custom-tab ${file.id === activeFileId ? 'active' : ''}`}
                  onClick={() => setActiveFileId(file.id)}
                  title={file.path || file.name}
                >
                  <FileOutlined className="custom-tab-icon" />
                  <span className="editor-tab-filename">{file.name}</span>
                  {file.modified && <span className="editor-modified-dot">●</span>}
                  <CloseOutlined
                    className="editor-tab-close"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleCloseFile(file.id)
                    }}
                  />
                </div>
              ))}
            </div>
            <Dropdown
              menu={{
                items: files.map(file => ({
                  key: file.id,
                  label: (
                    <span>
                      <FileOutlined style={{ marginRight: 6, fontSize: 12 }} />
                      {file.name}
                      {file.modified && <span style={{ color: '#52c41a', marginLeft: 4 }}>●</span>}
                    </span>
                  ),
                })),
                selectedKeys: activeFileId ? [activeFileId] : [],
                onClick: ({ key }) => setActiveFileId(key),
              }}
              trigger={['click']}
              placement="bottomRight"
            >
              <div className="tab-list-btn" title="All open files">
                <EllipsisOutlined />
              </div>
            </Dropdown>
          </div>

          {/* Editor content — all editors mounted, only active visible */}
          <div className="editor-content-area">
            {files.map((file) => (
              <div
                key={file.id}
                className={`editor-pane ${file.id === activeFileId ? 'editor-pane-active' : ''}`}
              >
                <Editor
                  height="100%"
                  language={file.language}
                  value={file.content}
                  onChange={(value) => handleEditorChange(value, file.id)}
                  onMount={(editor) => handleEditorMount(editor, file.id)}
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
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal
        title="Save File As"
        open={saveAsModalVisible}
        onOk={handleSaveAs}
        onCancel={() => setSaveAsModalVisible(false)}
        okText="Save"
      >
        <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>
          Default: {defaultDirectory ? `${defaultDirectory}/Untitled.txt` : 'Loading...'}
        </div>
        <Input
          placeholder="Leave empty for default, or enter custom path"
          value={saveAsPath}
          onChange={(e) => setSaveAsPath(e.target.value)}
          onPressEnter={handleSaveAs}
          autoFocus
        />
      </Modal>
    </div>
  )
}

export default EditorTab
