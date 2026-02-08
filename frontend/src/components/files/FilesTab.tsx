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
} from '../../../wailsjs/go/app/App'
import './FilesTab.css'

interface TabData {
  id: string
  name: string
  path: string
}

const FilesTab: React.FC = () => {
  const { t } = useTranslation(['files', 'common'])
  const [tabs, setTabs] = useState<TabData[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const tabBarRef = useRef<HTMLDivElement>(null)
  const dragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [isDraggingTab, setIsDraggingTab] = useState<string | null>(null)
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number } | null>(null)

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

  // Initialize with home directory
  useEffect(() => {
    GetHomeDirectory().then(home => {
      const newTab: TabData = {
        id: `tab-${Date.now()}`,
        name: t('files:home'),
        path: home,
      }
      setTabs([newTab])
      setActiveTabId(newTab.id)
    })
  }, [t])

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

  // Tab dragging for pop-out
  const handleTabDragStart = useCallback(
    (e: React.DragEvent, tabId: string) => {
      setIsDraggingTab(tabId)
      setDragStartPos({ x: e.clientX, y: e.clientY })
      e.dataTransfer.effectAllowed = 'move'
      // Store tab data for drag
      const tab = tabs.find(t => t.id === tabId)
      if (tab) {
        e.dataTransfer.setData('text/plain', tab.path)
      }
    },
    [tabs]
  )

  const handleTabDragEnd = useCallback(
    async (e: React.DragEvent, tabId: string) => {
      setIsDraggingTab(null)
      setDragStartPos(null)

      // Check if dragged out of window
      if (dragStartPos) {
        const dx = Math.abs(e.clientX - dragStartPos.x)
        const dy = Math.abs(e.clientY - dragStartPos.y)

        // If dragged significantly (more than 100px), open in new window
        if (dx > 100 || dy > 100) {
          const tab = tabs.find(t => t.id === tabId)
          if (tab) {
            try {
              await OpenFileBrowserWindow(tab.path)
              handleCloseTab(tabId)
              message.success(t('files:openedInNewWindow'))
            } catch (err: any) {
              message.error(t('files:failedToOpenWindow', { error: err.message }))
            }
          }
        }
      }
    },
    [tabs, dragStartPos, handleCloseTab, t]
  )

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
          {tabs.map(tab => (
            <div
              key={tab.id}
              className={`files-tab ${tab.id === activeTabId ? 'active' : ''}`}
              onClick={() => setActiveTabId(tab.id)}
              draggable
              onDragStart={e => handleTabDragStart(e, tab.id)}
              onDragEnd={e => handleTabDragEnd(e, tab.id)}
            >
              <FolderOutlined className="files-tab-icon" />
              <span className="files-tab-name">{tab.name}</span>
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
                  {tab.name}
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
