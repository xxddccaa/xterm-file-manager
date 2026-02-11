import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  FolderOutlined,
  FileOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  UpOutlined,
  CopyOutlined,
  ScissorOutlined,
  SnippetsOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  CodeOutlined,
  PlusOutlined,
  FolderAddOutlined,
  FileAddOutlined,
  ExportOutlined,
} from '@ant-design/icons'
import { Input, Button, Modal, message } from 'antd'
import {
  ListLocalFiles,
  GetHomeDirectory,
  GetParentDirectory,
  OpenEditorWindow,
  OpenTerminalAtPath,
  RenameLocalFile,
  DeleteLocalFile,
  DeleteLocalDirectory,
  CopyLocalFile,
  CopyLocalDirectory,
  CreateLocalFile,
  CreateLocalDirectory,
  MoveLocalFile,
  SetFileClipboard,
  GetFileClipboard,
  PasteFiles,
  IsDirectory,
  CopyFilesToSystemClipboard,
} from '../../../wailsjs/go/app/App'
import './FileBrowserPanel.css'

export interface LocalFile {
  name: string
  path: string
  isDir: boolean
  size: number
  modTime: string
}

interface NavigationState {
  back: string[]
  forward: string[]
}

interface FileBrowserPanelProps {
  initialPath: string
  onPathChange?: (path: string) => void
  standalone?: boolean
}

const FileBrowserPanel: React.FC<FileBrowserPanelProps> = ({
  initialPath,
  onPathChange,
  standalone = false,
}) => {
  const [currentPath, setCurrentPath] = useState<string>(initialPath || '')
  const [files, setFiles] = useState<LocalFile[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set())
  const [lastClickedFile, setLastClickedFile] = useState<string | null>(null)
  const [navigation, setNavigation] = useState<NavigationState>({ back: [], forward: [] })
  const [editingPath, setEditingPath] = useState(false)
  const [pathInput, setPathInput] = useState('')
  const [renamingFile, setRenamingFile] = useState<LocalFile | null>(null)
  const [newFileName, setNewFileName] = useState('')
  const [clipboard, setClipboard] = useState<{ files: string[]; operation: string } | null>(null)
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean
    x: number
    y: number
    file: LocalFile | null
  }>({ visible: false, x: 0, y: 0, file: null })

  const fileListRef = useRef<HTMLDivElement>(null)
  const contextMenuRef = useRef<HTMLDivElement>(null)
  const renameSubmittedRef = useRef(false)

  // Initialize
  useEffect(() => {
    if (initialPath) {
      loadFiles(initialPath)
    } else {
      GetHomeDirectory().then(home => loadFiles(home))
    }
  }, [initialPath])

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(prev => ({ ...prev, visible: false }))
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  // Load files in directory
  const loadFiles = async (path: string) => {
    try {
      setLoading(true)
      const fileList = await ListLocalFiles(path)
      setFiles(fileList || [])
      setCurrentPath(path)
      setPathInput(path)
      onPathChange?.(path)
      // Update clipboard state
      const cb = await GetFileClipboard()
      if (cb && cb.files && cb.files.length > 0) {
        setClipboard({ files: cb.files, operation: cb.operation })
      } else {
        setClipboard(null)
      }
    } catch (err: any) {
      message.error('Failed to list files: ' + (err?.message || 'Unknown error'))
    } finally {
      setLoading(false)
    }
  }

  // Navigation
  const navigateTo = useCallback(
    (path: string, recordHistory = true) => {
      if (path === currentPath) return
      if (recordHistory) {
        setNavigation(prev => ({
          back: [...prev.back, currentPath],
          forward: [],
        }))
      }
      loadFiles(path)
    },
    [currentPath]
  )

  const goBack = useCallback(() => {
    if (navigation.back.length === 0) return
    const prevPath = navigation.back[navigation.back.length - 1]
    const newBack = navigation.back.slice(0, -1)
    setNavigation(prev => ({
      back: newBack,
      forward: [currentPath, ...prev.forward],
    }))
    loadFiles(prevPath)
  }, [navigation, currentPath])

  const goForward = useCallback(() => {
    if (navigation.forward.length === 0) return
    const nextPath = navigation.forward[0]
    const newForward = navigation.forward.slice(1)
    setNavigation(prev => ({
      back: [...prev.back, currentPath],
      forward: newForward,
    }))
    loadFiles(nextPath)
  }, [navigation, currentPath])

  const goUp = useCallback(async () => {
    try {
      const parent = await GetParentDirectory(currentPath)
      if (parent && parent !== currentPath) {
        navigateTo(parent)
      }
    } catch (err) {
      // Already at root
    }
  }, [currentPath, navigateTo])

  // File operations
  const handleFileDoubleClick = useCallback(
    (file: LocalFile) => {
      if (file.isDir) {
        navigateTo(file.path)
      } else {
        OpenEditorWindow(file.path, false, '').catch((err: any) =>
          message.error(`Failed to open editor: ${err?.message || err}`)
        )
      }
    },
    [navigateTo]
  )

  const handleFileClick = useCallback((e: React.MouseEvent, file: LocalFile) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
    const isMultiKey = isMac ? e.metaKey : e.ctrlKey
    const isRangeKey = e.shiftKey

    if (isRangeKey && lastClickedFile) {
      const fileNames = files.map(f => f.name)
      const startIdx = fileNames.indexOf(lastClickedFile)
      const endIdx = fileNames.indexOf(file.name)
      if (startIdx >= 0 && endIdx >= 0) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx]
        const rangeNames = fileNames.slice(from, to + 1)
        setSelectedFiles(new Set(isMultiKey ? [...selectedFiles, ...rangeNames] : rangeNames))
      }
    } else if (isMultiKey) {
      const newSet = new Set(selectedFiles)
      if (newSet.has(file.name)) {
        newSet.delete(file.name)
      } else {
        newSet.add(file.name)
      }
      setSelectedFiles(newSet)
    } else {
      setSelectedFiles(new Set(selectedFiles.has(file.name) && selectedFiles.size === 1 ? [] : [file.name]))
    }
    setLastClickedFile(file.name)
  }, [selectedFiles, lastClickedFile, files])

  // Path editing
  const handlePathSubmit = useCallback(() => {
    setEditingPath(false)
    if (pathInput !== currentPath) {
      navigateTo(pathInput)
    }
  }, [pathInput, currentPath, navigateTo])

  const handlePathKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handlePathSubmit()
      else if (e.key === 'Escape') {
        setEditingPath(false)
        setPathInput(currentPath)
      }
    },
    [handlePathSubmit, currentPath]
  )

  // Context menu
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, file: LocalFile) => {
      e.preventDefault()
      e.stopPropagation()
      if (!selectedFiles.has(file.name)) {
        setSelectedFiles(new Set([file.name]))
      }
      setContextMenu({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        file,
      })
    },
    [selectedFiles]
  )

  // Rename
  const handleRename = useCallback(async () => {
    if (renameSubmittedRef.current) return
    renameSubmittedRef.current = true

    const file = renamingFile
    const name = newFileName.trim()
    setRenamingFile(null)
    setNewFileName('')

    if (!file || !name || name === file.name) {
      setTimeout(() => {
        renameSubmittedRef.current = false
      }, 50)
      return
    }

    try {
      await RenameLocalFile(file.path, name)
      message.success(`Renamed to: ${name}`)
      loadFiles(currentPath)
    } catch (err: any) {
      message.error(`Rename failed: ${err?.message || err}`)
    } finally {
      setTimeout(() => {
        renameSubmittedRef.current = false
      }, 50)
    }
  }, [renamingFile, newFileName, currentPath])

  const cancelRename = useCallback(() => {
    renameSubmittedRef.current = true
    setRenamingFile(null)
    setNewFileName('')
    setTimeout(() => {
      renameSubmittedRef.current = false
    }, 50)
  }, [])

  // Delete
  const handleDelete = useCallback(
    async (file: LocalFile) => {
      Modal.confirm({
        title: `Delete ${file.isDir ? 'directory' : 'file'}?`,
        content: `Are you sure you want to delete "${file.name}"? This action cannot be undone.`,
        okText: 'Delete',
        okType: 'danger',
        cancelText: 'Cancel',
        onOk: async () => {
          try {
            if (file.isDir) {
              await DeleteLocalDirectory(file.path)
            } else {
              await DeleteLocalFile(file.path)
            }
            message.success(`Deleted: ${file.name}`)
            loadFiles(currentPath)
          } catch (err: any) {
            message.error(`Delete failed: ${err?.message || err}`)
          }
        },
      })
    },
    [currentPath]
  )

  // Copy/Cut/Paste
  const handleCopy = useCallback(
    async (files: LocalFile[]) => {
      const paths = files.map(f => f.path)
      try {
        await SetFileClipboard(paths, 'copy')
        setClipboard({ files: paths, operation: 'copy' })
        message.success(`Copied ${files.length} item(s)`)
      } catch (err: any) {
        message.error(`Copy failed: ${err?.message || err}`)
      }
    },
    []
  )

  const handleCut = useCallback(
    async (files: LocalFile[]) => {
      const paths = files.map(f => f.path)
      try {
        await SetFileClipboard(paths, 'cut')
        setClipboard({ files: paths, operation: 'cut' })
        message.success(`Cut ${files.length} item(s)`)
      } catch (err: any) {
        message.error(`Cut failed: ${err?.message || err}`)
      }
    },
    []
  )

  const handleCopyToSystemClipboard = useCallback(
    async (files: LocalFile[]) => {
      const paths = files.map(f => f.path)
      try {
        await CopyFilesToSystemClipboard(paths)
        message.success(`Copied ${files.length} item(s) to system clipboard`)
      } catch (err: any) {
        message.error(`Copy to clipboard failed: ${err?.message || err}`)
      }
    },
    []
  )

  const handlePaste = useCallback(async () => {
    if (!clipboard || clipboard.files.length === 0) {
      message.info('Clipboard is empty')
      return
    }
    try {
      await PasteFiles(currentPath)
      message.success('Paste complete')
      loadFiles(currentPath)
      // Update clipboard state
      const newCb = await GetFileClipboard()
      if (newCb && newCb.files && newCb.files.length > 0) {
        setClipboard({ files: newCb.files, operation: newCb.operation })
      } else {
        setClipboard(null)
      }
    } catch (err: any) {
      message.error(`Paste failed: ${err?.message || err}`)
    }
  }, [clipboard, currentPath])

  // Create new
  const handleNewFile = useCallback(async () => {
    Modal.prompt({
      title: 'New File',
      placeholder: 'Enter file name',
      onOk: async (name: string) => {
        if (!name) return
        try {
          const newPath = `${currentPath}/${name}`
          await CreateLocalFile(newPath)
          message.success(`Created: ${name}`)
          loadFiles(currentPath)
        } catch (err: any) {
          message.error(`Failed: ${err?.message || err}`)
        }
      },
    })
  }, [currentPath])

  const handleNewFolder = useCallback(async () => {
    Modal.prompt({
      title: 'New Folder',
      placeholder: 'Enter folder name',
      onOk: async (name: string) => {
        if (!name) return
        try {
          const newPath = `${currentPath}/${name}`
          await CreateLocalDirectory(newPath)
          message.success(`Created: ${name}`)
          loadFiles(currentPath)
        } catch (err: any) {
          message.error(`Failed: ${err?.message || err}`)
        }
      },
    })
  }, [currentPath])

  // Terminal integration
  const handleOpenTerminal = useCallback(async () => {
    try {
      await OpenTerminalAtPath(currentPath)
      message.success(`Opening Terminal at: ${currentPath}`)
    } catch (err: any) {
      message.error(`Failed: ${err?.message || err}`)
    }
  }, [currentPath])

  // Keyboard shortcuts
  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return
      }

      const hasCtrl = e.ctrlKey || e.metaKey

      // Navigation shortcuts
      if (hasCtrl && e.key === '[') {
        e.preventDefault()
        goBack()
      } else if (hasCtrl && e.key === ']') {
        e.preventDefault()
        goForward()
      } else if (hasCtrl && e.key === 'ArrowUp') {
        e.preventDefault()
        goUp()
      } else if (e.key === 'F5' || (hasCtrl && e.key === 'r')) {
        e.preventDefault()
        loadFiles(currentPath)
      }

      // File operations — use all selected files
      else if (hasCtrl && e.key === 'c') {
        if (selectedFiles.size > 0) {
          e.preventDefault()
          const selected = files.filter(f => selectedFiles.has(f.name))
          if (selected.length > 0) handleCopy(selected)
        }
      } else if (hasCtrl && e.key === 'x') {
        if (selectedFiles.size > 0) {
          e.preventDefault()
          const selected = files.filter(f => selectedFiles.has(f.name))
          if (selected.length > 0) handleCut(selected)
        }
      } else if (hasCtrl && e.key === 'v') {
        e.preventDefault()
        handlePaste()
      } else if (e.key === 'F2' || e.key === 'Enter') {
        // Rename only works with single selection
        const singleSelected = selectedFiles.size === 1 ? [...selectedFiles][0] : null
        if (singleSelected) {
          e.preventDefault()
          const file = files.find(f => f.name === singleSelected)
          if (file) {
            setRenamingFile(file)
            setNewFileName(file.name)
          }
        }
      } else if (e.key === 'Delete') {
        e.preventDefault()
        const singleSelected = selectedFiles.size === 1 ? [...selectedFiles][0] : null
        if (singleSelected) {
          const file = files.find(f => f.name === singleSelected)
          if (file) handleDelete(file)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [goBack, goForward, goUp, currentPath, selectedFiles, files, handleCopy, handleCut, handlePaste, handleDelete])

  // Render helpers
  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '-'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const formatDate = (isoStr: string): string => {
    if (!isoStr) return ''
    const d = new Date(isoStr)
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const getBreadcrumbs = () => {
    const parts = currentPath.split('/').filter(Boolean)
    const crumbs: { name: string; path: string }[] = [{ name: '/', path: '/' }]
    let accumulated = ''
    for (const part of parts) {
      accumulated += '/' + part
      crumbs.push({ name: part, path: accumulated })
    }
    return crumbs
  }

  const canPaste = clipboard && clipboard.files.length > 0

  return (
    <div className="file-browser-panel">
      {/* Toolbar */}
      <div className="fb-toolbar">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={goBack}
          disabled={navigation.back.length === 0}
          title="Back (Ctrl+[)"
          size="small"
        />
        <Button
          icon={<ArrowRightOutlined />}
          onClick={goForward}
          disabled={navigation.forward.length === 0}
          title="Forward (Ctrl+])"
          size="small"
        />
        <Button
          icon={<UpOutlined />}
          onClick={goUp}
          disabled={currentPath === '/'}
          title="Up (Ctrl+↑)"
          size="small"
        />

        {editingPath ? (
          <Input
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            onBlur={handlePathSubmit}
            onKeyDown={handlePathKeyDown}
            autoFocus
            className="fb-path-input"
            size="small"
          />
        ) : (
          <div className="fb-path-bar" onClick={() => setEditingPath(true)}>
            {getBreadcrumbs().map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span className="fb-crumb-sep">›</span>}
                <span
                  className="fb-crumb"
                  onClick={e => {
                    e.stopPropagation()
                    navigateTo(crumb.path)
                  }}
                >
                  {crumb.name}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}

        <div className="fb-toolbar-actions">
          <Button
            icon={<FileAddOutlined />}
            onClick={handleNewFile}
            title="New File"
            size="small"
          />
          <Button
            icon={<FolderAddOutlined />}
            onClick={handleNewFolder}
            title="New Folder"
            size="small"
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => loadFiles(currentPath)}
            title="Refresh (F5)"
            size="small"
          />
          <Button
            icon={<CodeOutlined />}
            onClick={handleOpenTerminal}
            title="Open Terminal Here"
            size="small"
          />
        </div>
      </div>

      {/* File List */}
      <div className="fb-file-list" ref={fileListRef} tabIndex={-1}>
        {loading ? (
          <div className="fb-empty">Loading...</div>
        ) : files.length === 0 ? (
          <div className="fb-empty">Empty directory</div>
        ) : (
          files.map((file, index) => (
            <div
              key={index}
              className={`fb-file-item ${file.isDir ? 'fb-dir' : 'fb-file'} ${
                selectedFiles.has(file.name) ? 'fb-selected' : ''
              }`}
              onClick={e => handleFileClick(e, file)}
              onDoubleClick={() => handleFileDoubleClick(file)}
              onContextMenu={e => handleContextMenu(e, file)}
            >
              <span className="fb-file-icon">
                {file.isDir ? (
                  <FolderOutlined className="fb-icon-folder" />
                ) : (
                  <FileOutlined className="fb-icon-file" />
                )}
              </span>
              {renamingFile?.name === file.name ? (
                <input
                  className="fb-file-name-input"
                  value={newFileName}
                  onChange={e => setNewFileName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.stopPropagation()
                      handleRename()
                    } else if (e.key === 'Escape') {
                      e.stopPropagation()
                      cancelRename()
                    }
                  }}
                  onBlur={handleRename}
                  autoFocus
                  onFocus={e => {
                    const val = e.target.value
                    const dot = val.lastIndexOf('.')
                    if (dot > 0 && !file.isDir) {
                      e.target.setSelectionRange(0, dot)
                    } else {
                      e.target.select()
                    }
                  }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span className="fb-file-name">{file.name}</span>
              )}
              <span className="fb-file-date">{formatDate(file.modTime)}</span>
              <span className="fb-file-size">{file.isDir ? '-' : formatSize(file.size)}</span>
            </div>
          ))
        )}
      </div>

      {/* Status Bar */}
      <div className="fb-statusbar">
        <span>{files.length} items{selectedFiles.size > 0 ? ` · ${selectedFiles.size} selected` : ''}</span>
        <span className="fb-status-path">{currentPath}</span>
      </div>

      {/* Context Menu */}
      {contextMenu.visible && contextMenu.file && (
        <div
          ref={contextMenuRef}
          className="fb-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          {!contextMenu.file.isDir && (
            <div
              className="fb-context-item"
              onClick={() => {
                handleFileDoubleClick(contextMenu.file!)
                setContextMenu(prev => ({ ...prev, visible: false }))
              }}
            >
              <EditOutlined />
              <span>Open</span>
            </div>
          )}
          {contextMenu.file.isDir && (
            <div
              className="fb-context-item"
              onClick={() => {
                navigateTo(contextMenu.file!.path)
                setContextMenu(prev => ({ ...prev, visible: false }))
              }}
            >
              <FolderOutlined />
              <span>Open Folder</span>
            </div>
          )}
          <div className="fb-context-divider" />
          <div
            className="fb-context-item"
            onClick={() => {
              const selected = files.filter(f => selectedFiles.has(f.name))
              handleCopy(selected.length > 0 ? selected : [contextMenu.file!])
              setContextMenu(prev => ({ ...prev, visible: false }))
            }}
          >
            <CopyOutlined />
            <span>Copy{selectedFiles.size > 1 ? ` (${selectedFiles.size})` : ''} (Ctrl+C)</span>
          </div>
          <div
            className="fb-context-item"
            onClick={() => {
              const selected = files.filter(f => selectedFiles.has(f.name))
              handleCut(selected.length > 0 ? selected : [contextMenu.file!])
              setContextMenu(prev => ({ ...prev, visible: false }))
            }}
          >
            <ScissorOutlined />
            <span>Cut{selectedFiles.size > 1 ? ` (${selectedFiles.size})` : ''} (Ctrl+X)</span>
          </div>
          {canPaste && (
            <div
              className="fb-context-item"
              onClick={() => {
                handlePaste()
                setContextMenu(prev => ({ ...prev, visible: false }))
              }}
            >
              <SnippetsOutlined />
              <span>Paste (Ctrl+V)</span>
            </div>
          )}
          <div
            className="fb-context-item"
            onClick={() => {
              const selected = files.filter(f => selectedFiles.has(f.name))
              handleCopyToSystemClipboard(selected.length > 0 ? selected : [contextMenu.file!])
              setContextMenu(prev => ({ ...prev, visible: false }))
            }}
          >
            <ExportOutlined />
            <span>Copy to System Clipboard{selectedFiles.size > 1 ? ` (${selectedFiles.size})` : ''}</span>
          </div>
          <div className="fb-context-divider" />
          <div
            className="fb-context-item"
            onClick={() => {
              setRenamingFile(contextMenu.file!)
              setNewFileName(contextMenu.file!.name)
              setContextMenu(prev => ({ ...prev, visible: false }))
            }}
          >
            <EditOutlined />
            <span>Rename (F2)</span>
          </div>
          <div
            className="fb-context-item danger"
            onClick={() => {
              handleDelete(contextMenu.file!)
              setContextMenu(prev => ({ ...prev, visible: false }))
            }}
          >
            <DeleteOutlined />
            <span>Delete (Del)</span>
          </div>
        </div>
      )}
    </div>
  )
}

export default FileBrowserPanel
