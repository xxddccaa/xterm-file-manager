import React, { useState, useEffect, useRef } from 'react'
import { Tabs, Spin } from 'antd'
import type { TabsProps } from 'antd'
import ErrorBoundary from './components/ErrorBoundary'
import TerminalTab from './components/terminal/TerminalTab'
import ToolsTab from './components/tools/ToolsTab'
import EditorTab from './components/editor/EditorTab'
import { OnFileDrop, OnFileDropOff } from '../wailsjs/runtime/runtime'
import './App.css'

const App: React.FC = () => {
  const [wailsReady, setWailsReady] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('terminal')
  const activeTabRef = useRef(activeTab)

  // Keep ref in sync with state so OnFileDrop closure always sees the latest tab
  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  useEffect(() => {
    // Check for Wails runtime
    const checkWails = () => {
      if ((window as any).go?.app?.App) {
        console.log('✅ Wails runtime found!')
        setWailsReady(true)
      } else {
        console.log('⏳ Waiting for Wails runtime...')
        setTimeout(checkWails, 100)
      }
    }
    
    setTimeout(checkWails, 200)
  }, [])

  // Global OnFileDrop: registered ONCE, dispatches to the active tab via custom events
  useEffect(() => {
    if (!wailsReady) return

    console.log('🎯 [App] Registering global OnFileDrop listener')
    OnFileDrop((_x: number, _y: number, paths: string[]) => {
      console.log('📥 [App] OnFileDrop triggered, activeTab:', activeTabRef.current, 'paths:', paths)
      
      // Always dispatch clear-drag event first (Wails OnFileDrop bypasses browser onDrop)
      window.dispatchEvent(new CustomEvent('app:clear-drag-state'))
      
      if (!paths || paths.length === 0) return

      const tab = activeTabRef.current
      if (tab === 'editor') {
        window.dispatchEvent(new CustomEvent('app:file-drop-editor', { detail: { paths } }))
      } else if (tab === 'terminal') {
        window.dispatchEvent(new CustomEvent('app:file-drop-terminal', { detail: { paths } }))
      }
    }, true)

    return () => {
      console.log('🧹 [App] Cleaning up global OnFileDrop listener')
      OnFileDropOff()
    }
  }, [wailsReady])

  // Show minimal loading screen if Wails not ready
  if (!wailsReady) {
    return <div className="loading-container" />
  }

  const tabItems: TabsProps['items'] = [
    {
      key: 'terminal',
      label: 'Terminal',
      children: <TerminalTab />,
    },
    {
      key: 'tools',
      label: 'Tools',
      children: <ToolsTab />,
    },
    {
      key: 'editor',
      label: 'Editor',
      children: <EditorTab />,
    },
  ]

  return (
    <ErrorBoundary>
      <div className="app-container">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={tabItems}
          className="main-tabs"
        />
      </div>
    </ErrorBoundary>
  )
}

export default App
