import React, { useState, useEffect } from 'react'
import { Tabs, Spin } from 'antd'
import type { TabsProps } from 'antd'
import ErrorBoundary from './components/ErrorBoundary'
import TerminalTab from './components/terminal/TerminalTab'
import ToolsTab from './components/tools/ToolsTab'
import EditorTab from './components/editor/EditorTab'
import './App.css'

const App: React.FC = () => {
  const [wailsReady, setWailsReady] = useState(false)
  const [activeTab, setActiveTab] = useState<string>('terminal')

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
