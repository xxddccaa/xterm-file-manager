import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Button, Dropdown, message } from 'antd'
import {
  PlusOutlined,
  CloseOutlined,
  FolderOutlined,
  EllipsisOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import FileBrowserPanel from './FileBrowserPanel'
import {
  GetHomeDirectory,
  OpenFileBrowserWindow,
  ListLocalFiles,
  SaveFilesTabs,
  LoadFilesTabs,
} from '../../../wailsjs/go/app/App'
import './FilesTab.css'

interface TabData {
  id: string
  name: string
  customName?: string  // User-defined custom name (if renamed via double-click)
  path: string
}

const FilesTab: React.FC = () => {
  const { t } = useTranslation(['files', 'common'])
  const [tabs, setTabs] = useState<TabData[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const tabBarRef = useRef<HTMLDivElement>(null)
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Tab rename state
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const renameInputRef = useRef<any>(null)

  // Create a new tab - always creates, even if same path exists
  const createTab = useCallback((path: string) => {
    const name = path.split('/').pop() || t('files:home')
    const newTab: TabData = {
      id: `tab-${Date.now()}-${Math.random()}`,
      name,
      path,
    }
    setTabs(prev => [newTab, ...prev])
    setActiveTabId(newTab.id)
    setTimeout(() => {
      if (tabBarRef.current) {
        tabBarRef.current.scrollLeft = 0
      }
    }, 0)
  }, [t])

  const handleNewTab = useCallback(async () => {
    try {
      const home = await GetHomeDirectory()
      createTab(home)
    } catch {
      createTab('/')
    }
  }, [createTab])

  // Initialize with saved tabs or home directory
  useEffect(() => {
    loadSavedTabs()
  }, [])

  // Auto-save tabs when they change (with debounce)
  useEffect(() => {
    const timer = setTimeout(() => {
      saveTabs()
    }, 500)
    return () => clearTimeout(timer)
  }, [tabs, activeTabId])

  // Save tabs to disk
  const saveTabs = async () => {
    if (tabs.length === 0) {
      try {
        await SaveFilesTabs(JSON.stringify({ tabs: [], activeTabId: null }))
        console.log('💾 Cleared persisted files tabs (no open tabs)')
      } catch (error) {
        console.error('Failed to clear files tabs:', error)
      }
      return
    }

    try {
      const data = {
        tabs: tabs.map(t => ({
          id: t.id,
          name: t.name,
          customName: t.customName,
          path: t.path,
        })),
        activeTabId
      }
      await SaveFilesTabs(JSON.stringify(data))
      console.log('💾 Saved files tabs:', tabs.length)
    } catch (error) {
      console.error('Failed to save files tabs:', error)
    }
  }

  // Load saved tabs from disk
  const loadSavedTabs = async () => {
    try {
      const dataJSON = await LoadFilesTabs()
      if (!dataJSON || dataJSON === '{}') {
        // No saved tabs, initialize with home directory
        initializeDefaultTab()
        return
      }

      const data = JSON.parse(dataJSON)
      if (!data.tabs || data.tabs.length === 0) {
        initializeDefaultTab()
        return
      }

      console.log('📂 Loading saved files tabs:', data.tabs.length)
      setTabs(data.tabs)
      
      if (data.activeTabId && data.tabs.find((t: TabData) => t.id === data.activeTabId)) {
        setActiveTabId(data.activeTabId)
      } else if (data.tabs.length > 0) {
        setActiveTabId(data.tabs[0].id)
      }

      message.success(t('files:restoredTabs', { count: data.tabs.length }))
    } catch (error) {
      console.error('Failed to load files tabs:', error)
      initializeDefaultTab()
    }
  }

  const initializeDefaultTab = () => {
    GetHomeDirectory().then(home => {
      const newTab: TabData = {
        id: `tab-${Date.now()}`,
        name: t('files:home'),
        path: home,
      }
      setTabs([newTab])
      setActiveTabId(newTab.id)
    }).catch(() => {
      // Fallback to root if home directory fails
      const newTab: TabData = {
        id: `tab-${Date.now()}`,
        name: '/',
        path: '/',
      }
      setTabs([newTab])
      setActiveTabId(newTab.id)
    })
  }

  // Listen for file drops from Finder
  useEffect(() => {
    const handler = async (e: Event) => {
      const paths = (e as CustomEvent).detail?.paths as string[]
      if (!paths || paths.length === 0) return

      for (const droppedPath of paths) {
        try {
          // Check if it's a directory by attempting to list it
          await ListLocalFiles(droppedPath)
          // It's a directory - open it in a new tab
          createTab(droppedPath)
        } catch {
          // It's a file - open its parent directory in a new tab
          const parts = droppedPath.split('/')
          parts.pop()
          const parentPath = parts.join('/') || '/'
          createTab(parentPath)
        }
      }
    }

    window.addEventListener('app:file-drop-files', handler)
    return () => window.removeEventListener('app:file-drop-files', handler)
  }, [createTab])

  const handleCloseTab = useCallback(
    (tabId: string) => {
      setTabs(prev => {
        const idx = prev.findIndex(t => t.id === tabId)
        const newTabs = prev.filter(t => t.id !== tabId)

        // Update active tab if closing the current one
        if (activeTabId === tabId) {
          const newActive = newTabs.length > 0
            ? newTabs[Math.min(idx, newTabs.length - 1)].id
            : null
          setActiveTabId(newActive)
        }

        // Reset scroll when closing first tab
        if (idx === 0 && tabBarRef.current) {
          setTimeout(() => {
            if (tabBarRef.current) tabBarRef.current.scrollLeft = 0
          }, 0)
        }

        return newTabs
      })
    },
    [activeTabId]
  )

  const handleTabPathChange = useCallback(
    (tabId: string, newPath: string) => {
      setTabs(prev =>
        prev.map(tab =>
          tab.id === tabId
            ? { ...tab, path: newPath, name: newPath.split('/').pop() || t('files:home') }
            : tab
        )
      )
    },
    [t]
  )

  // Tab drag handlers for reordering
  const [draggedTabIndex, setDraggedTabIndex] = useState<number | null>(null)

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
    
    // Reorder tabs array
    const newTabs = [...tabs]
    const [draggedTab] = newTabs.splice(draggedTabIndex, 1)
    newTabs.splice(index, 0, draggedTab)
    setTabs(newTabs)
    setDraggedTabIndex(index)
  }, [draggedTabIndex, tabs])

  const handleTabDragEnd = useCallback((e: React.DragEvent) => {
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '1'
    }
    setDraggedTabIndex(null)
  }, [])

  // Tab rename handlers
  const handleTabDoubleClick = useCallback((tab: TabData) => {
    setRenamingTabId(tab.id)
    setRenameValue(tab.customName || tab.name)
    // Focus input after state update
    setTimeout(() => {
      if (renameInputRef.current) {
        renameInputRef.current.focus()
        renameInputRef.current.select()
      }
    }, 0)
  }, [])

  const handleRenameConfirm = useCallback(() => {
    if (!renamingTabId || !renameValue.trim()) {
      setRenamingTabId(null)
      return
    }

    setTabs(prev => prev.map(t =>
      t.id === renamingTabId
        ? { ...t, customName: renameValue.trim() }
        : t
    ))

    setRenamingTabId(null)
    setRenameValue('')
  }, [renamingTabId, renameValue])

  const handleRenameCancel = useCallback(() => {
    setRenamingTabId(null)
    setRenameValue('')
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const hasCtrl = e.ctrlKey || e.metaKey

      // Cmd+T: New tab
      if (hasCtrl && e.key === 't') {
        e.preventDefault()
        handleNewTab()
      }
      // Cmd+W: Close tab
      else if (hasCtrl && e.key === 'w') {
        e.preventDefault()
        if (activeTabId) {
          handleCloseTab(activeTabId)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleNewTab, handleCloseTab, activeTabId])

  const activeTab = tabs.find(t => t.id === activeTabId)

  return (
    <div className="files-tab-container">
      {/* Tab Bar */}
      <div className="files-tab-bar-wrapper">
        <div className="files-tab-bar" ref={tabBarRef}>
          {tabs.map((tab, index) => (
            <div
              key={tab.id}
              className={`files-tab ${tab.id === activeTabId ? 'active' : ''}`}
              onClick={() => setActiveTabId(tab.id)}
              onDoubleClick={() => handleTabDoubleClick(tab)}
              draggable={true}
              onDragStart={e => handleTabDragStart(e, index)}
              onDragOver={e => handleTabDragOver(e, index)}
              onDragEnd={handleTabDragEnd}
            >
              <FolderOutlined className="files-tab-icon" />
              {renamingTabId === tab.id ? (
                <Input
                  ref={renameInputRef}
                  className="files-rename-input"
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
                <span className="files-tab-name">{tab.customName || tab.name}</span>
              )}
              <CloseOutlined
                className="files-tab-close"
                onClick={e => {
                  e.stopPropagation()
                  handleCloseTab(tab.id)
                }}
              />
            </div>
          ))}
        </div>

        <Dropdown
          menu={{
            items: tabs.map(tab => ({
              key: tab.id,
              label: (
                <span>
                  <FolderOutlined style={{ marginRight: 6, fontSize: 12 }} />
                  {tab.customName || tab.name}
                </span>
              ),
            })),
            selectedKeys: activeTabId ? [activeTabId] : [],
            onClick: ({ key }) => setActiveTabId(key),
          }}
          trigger={['click']}
          placement="bottomRight"
        >
          <div className="files-tab-list-btn" title={t('files:allTabs')}>
            <EllipsisOutlined />
          </div>
        </Dropdown>

        <Button
          className="files-new-tab-btn"
          icon={<PlusOutlined />}
          onClick={handleNewTab}
          size="small"
          title={t('files:newTabShortcut')}
        />
      </div>

      {/* Tab Content */}
      <div className="files-tab-content">
        {tabs.length === 0 ? (
          <div className="files-empty-state">
            <FolderOutlined style={{ fontSize: 64, color: '#888' }} />
            <p>{t('files:noTabsOpen')}</p>
            <p className="files-empty-hint">{t('files:clickToOpenOrDragFiles')}</p>
          </div>
        ) : (
          tabs.map(tab => (
            <div
              key={tab.id}
              className={`files-tab-pane ${tab.id === activeTabId ? 'active' : ''}`}
            >
              <FileBrowserPanel
                initialPath={tab.path}
                onPathChange={path => handleTabPathChange(tab.id, path)}
              />
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default FilesTab
