import React, { useState, useRef, useCallback, useEffect } from 'react'
import { Button, message, Modal, Input, Dropdown } from 'antd'
import { PlusOutlined, SaveOutlined, CloseOutlined, FileOutlined, FolderOpenOutlined, EllipsisOutlined } from '@ant-design/icons'
import Editor from '@monaco-editor/react'
import { useTranslation } from 'react-i18next'
import { ReadLocalFile, WriteLocalFile, CreateLocalFile, GetDefaultEditorDirectory, GetNextUntitledFileName, OpenFileDialog, SaveEditorTabs, LoadEditorTabs, ReadRemoteFile } from '../../../wailsjs/go/app/App'
import './EditorTab.css'

interface EditorFile {
  id: string
  path: string
  name: string
  customName?: string  // User-defined custom name (if renamed via double-click)
  content: string
  modified: boolean
  language: string
  isNew: boolean
  isRemote?: boolean  // Remote file via SSH
  sessionId?: string  // SSH session ID for remote files
  fileError?: string  // Error message if file couldn't be loaded
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
  const { t } = useTranslation(['editor', 'common'])
  const [files, setFiles] = useState<EditorFile[]>([])
  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [saveAsModalVisible, setSaveAsModalVisible] = useState(false)
  const [saveAsPath, setSaveAsPath] = useState('')
  const [defaultDirectory, setDefaultDirectory] = useState('')
  const editorRefs = useRef<{ [key: string]: any }>({})
  const fileCounterRef = useRef(1)
  const tabBarRef = useRef<HTMLDivElement>(null)

  // Tab drag and drop state for reordering
  const [draggedTabIndex, setDraggedTabIndex] = useState<number | null>(null)

  // Tab rename state
  const [renamingFileId, setRenamingFileId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<any>(null)

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
    loadSavedTabs()  // Load saved tabs on startup
  }, [])

  // Auto-save tabs when they change (with debounce)
  useEffect(() => {
    const timer = setTimeout(() => {
      saveTabs()
    }, 500)
    return () => clearTimeout(timer)
  }, [files, activeFileId])

  // Open file from path (uses ref to avoid stale closure)
  const openFileFromPath = useCallback(async (filePath: string) => {
    // Check if file is already open using ref (latest state)
    const currentFiles = filesRef.current
    const existingFile = currentFiles.find(f => f.path === filePath)
    if (existingFile) {
      setActiveFileId(existingFile.id)
      message.info(t('editor:fileAlreadyOpen'))
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
      message.success(t('editor:opened', { name: newFile.name }))
    } catch (err: any) {
      message.error(t('editor:failedToOpen', { error: err?.message || err }))
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

  // Listen for file open requests from backend (file association, command-line args)
  useEffect(() => {
    const handler = (e: Event) => {
      const filePath = (e as CustomEvent).detail?.path as string
      if (filePath) {
        console.log('📂 [EditorTab] Opening file from external request:', filePath)
        openFileFromPath(filePath)
      }
    }
    window.addEventListener('app:open-file-in-editor', handler)
    return () => window.removeEventListener('app:open-file-in-editor', handler)
  }, [openFileFromPath])

  // Save tabs to disk
  const saveTabs = async () => {
    if (files.length === 0) return
    try {
      const data = {
        files: files.map(f => ({
          id: f.id,
          path: f.path,
          name: f.name,
          customName: f.customName,
          language: f.language,
          isNew: f.isNew,
          isRemote: f.isRemote,
          sessionId: f.sessionId,
          // Don't save content or modified state
        })),
        activeFileId
      }
      await SaveEditorTabs(JSON.stringify(data))
      console.log('💾 Saved editor tabs')
    } catch (error) {
      console.error('Failed to save editor tabs:', error)
    }
  }

  // Load saved tabs and restore files
  const loadSavedTabs = async () => {
    try {
      const dataJSON = await LoadEditorTabs()
      if (!dataJSON || dataJSON === '{}') return

      const data = JSON.parse(dataJSON)
      if (!data.files || data.files.length === 0) return

      console.log('📂 Loading saved editor tabs:', data.files.length)

      // Restore files
      const restoredFiles: EditorFile[] = []
      for (const savedFile of data.files) {
        try {
          let content = ''
          let fileError: string | undefined

          if (savedFile.isRemote && savedFile.sessionId) {
            // Try to load remote file
            try {
              content = await ReadRemoteFile(savedFile.sessionId, savedFile.path)
              console.log(`✅ Loaded remote file: ${savedFile.name}`)
            } catch (err: any) {
              fileError = `Remote file unavailable: ${err?.message || err}`
              console.warn(`⚠️ Failed to load remote file ${savedFile.path}:`, err)
            }
          } else {
            // Try to load local file
            try {
              content = await ReadLocalFile(savedFile.path)
              console.log(`✅ Loaded local file: ${savedFile.name}`)
            } catch (err: any) {
              fileError = `File not found or inaccessible: ${err?.message || err}`
              console.warn(`⚠️ Failed to load local file ${savedFile.path}:`, err)
            }
          }

          const restoredFile: EditorFile = {
            id: savedFile.id,
            path: savedFile.path,
            name: savedFile.name,
            customName: savedFile.customName,
            content,
            modified: false,
            language: savedFile.language,
            isNew: savedFile.isNew,
            isRemote: savedFile.isRemote,
            sessionId: savedFile.sessionId,
            fileError
          }

          restoredFiles.push(restoredFile)
        } catch (err) {
          console.error(`Failed to restore file ${savedFile.path}:`, err)
        }
      }

      setFiles(restoredFiles)

      // Restore active file
      if (data.activeFileId) {
        setActiveFileId(data.activeFileId)
      } else if (restoredFiles.length > 0) {
        setActiveFileId(restoredFiles[0].id)
      }

      if (restoredFiles.length > 0) {
        message.success(t('editor:restoredTabs', { count: restoredFiles.length }))
      }
    } catch (error) {
      console.error('Failed to load editor tabs:', error)
    }
  }

  const handleNewFile = async () => {
    const newFile: EditorFile = {
      id: `new-${Date.now()}`,
      path: '',
      name: t('editor:untitled', { n: fileCounterRef.current++ }),
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
      message.error(t('editor:failedToOpen', { error: err?.message || err }))
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
      message.success(t('editor:fileSaved'))
    } catch (err: any) {
      message.error(t('editor:failedToSave', { error: err?.message || err }))
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
          message.error(t('editor:pleaseEnterPath'))
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
      message.success(t('editor:fileSavedAs', { name: getFileName(finalPath) }))
    } catch (err: any) {
      message.error(t('editor:failedToSave', { error: err?.message || err }))
      console.error('Failed to save file:', err)
    }
  }

  // Close file
  const handleCloseFile = (fileId: string) => {
    const file = files.find(f => f.id === fileId)
    if (!file) return

    if (file.modified) {
      Modal.confirm({
        title: t('editor:unsavedChanges'),
        content: t('editor:closeWithoutSaving', { name: file.name }),
        okText: t('editor:closeWithoutSavingBtn'),
        okType: 'danger',
        cancelText: t('common:cancel'),
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
    
    // Reorder files array
    const newFiles = [...files]
    const [draggedFile] = newFiles.splice(draggedTabIndex, 1)
    newFiles.splice(index, 0, draggedFile)
    setFiles(newFiles)
    setDraggedTabIndex(index)
  }, [draggedTabIndex, files])

  const handleTabDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1'
    }
    setDraggedTabIndex(null)
  }, [])

  // Tab rename handlers
  const handleTabDoubleClick = useCallback((file: EditorFile) => {
    setRenamingFileId(file.id)
    setRenameValue(file.customName || file.name)
    // Focus input after state update
    setTimeout(() => {
      if (renameInputRef.current) {
        renameInputRef.current.focus()
        renameInputRef.current.select()
      }
    }, 0)
  }, [])

  const handleRenameConfirm = useCallback(() => {
    if (!renamingFileId || !renameValue.trim()) {
      setRenamingFileId(null)
      return
    }

    setFiles(prev => prev.map(f =>
      f.id === renamingFileId
        ? { ...f, customName: renameValue.trim() }
        : f
    ))

    setRenamingFileId(null)
    setRenameValue('')
  }, [renamingFileId, renameValue])

  const handleRenameCancel = useCallback(() => {
    setRenamingFileId(null)
    setRenameValue('')
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
            <p>{t('editor:dropFilesToOpen')}</p>
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
          {t('editor:newFile')}
        </Button>
        <Button
          icon={<FolderOpenOutlined />}
          onClick={handleOpenFileDialog}
          size="small"
        >
          {t('editor:openFile')}
        </Button>
        {activeFileId && (
          <Button
            icon={<SaveOutlined />}
            onClick={() => handleSave()}
            size="small"
            disabled={!files.find(f => f.id === activeFileId)?.modified}
          >
            {t('common:save')}
          </Button>
        )}
      </div>

      {files.length === 0 ? (
        <div className="editor-empty-state">
          <FileOutlined style={{ fontSize: 64, color: '#888' }} />
          <p>{t('editor:noFilesOpen')}</p>
          <p className="editor-empty-hint">{t('editor:createOrDragFiles')}</p>
        </div>
      ) : (
        <div className="editor-main">
          {/* Tab bar wrapper: scrollable tabs + fixed "..." button */}
          <div className="tab-bar-wrapper">
            <div className="custom-tab-bar" ref={tabBarRef}>
              {files.map((file, index) => (
              <div
                key={file.id}
                className={`custom-tab ${activeFileId === file.id ? 'active' : ''} ${file.fileError ? 'error' : ''}`}
                draggable={true}
                onDragStart={(e) => handleTabDragStart(e, index)}
                onDragOver={(e) => handleTabDragOver(e, index)}
                onDragEnd={handleTabDragEnd}
                onClick={() => setActiveFileId(file.id)}
                onDoubleClick={() => handleTabDoubleClick(file)}
                title={file.fileError || file.path || file.name}
              >
                <span className="file-icon">
                  <FileOutlined />
                </span>
                {renamingFileId === file.id ? (
                  <Input
                    ref={renameInputRef}
                    className="editor-rename-input"
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
                  <span className="file-name">{file.customName || file.name}</span>
                )}
                {file.modified && <span className="modified-indicator">●</span>}
                {file.fileError && <span className="error-indicator">⚠</span>}
                <CloseOutlined
                  className="close-btn"
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
                      {file.customName || file.name}
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
              <div className="tab-list-btn" title={t('editor:allOpenFiles')}>
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
                {file.fileError ? (
                  <div className="editor-error-state">
                    <span className="error-icon">⚠️</span>
                    <h3>{t('editor:fileLoadError')}</h3>
                    <p>{file.fileError}</p>
                    <p className="error-hint">{t('editor:fileLoadErrorHint')}</p>
                  </div>
                ) : (
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
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal
        title={t('editor:saveFileAs')}
        open={saveAsModalVisible}
        onOk={handleSaveAs}
        onCancel={() => setSaveAsModalVisible(false)}
        okText={t('common:save')}
      >
        <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>
          {defaultDirectory ? t('editor:defaultPath', { path: defaultDirectory }) : t('common:loading')}
        </div>
        <Input
          placeholder={t('editor:pathPlaceholder')}
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
