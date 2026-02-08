import React, { useState } from 'react'
import { Layout, Menu } from 'antd'
import { FileTextOutlined, CodeOutlined, SwapOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import JsonFormatter from './JsonFormatter'
import CFormatter from './CFormatter'
import EscapeTool from './EscapeTool'
import './ToolsTab.css'

const { Sider, Content } = Layout

type ToolType = 'json' | 'c' | 'escape'

interface ToolItem {
  key: ToolType
  label: string
  icon: React.ReactNode
  component: React.ReactNode
}

const ToolsTab: React.FC = () => {
  const { t } = useTranslation('tools')
  const [selectedTool, setSelectedTool] = useState<ToolType>('json')

  const tools: ToolItem[] = [
    {
      key: 'json',
      label: t('jsonFormatter'),
      icon: <FileTextOutlined />,
      component: <JsonFormatter />,
    },
    {
      key: 'c',
      label: t('cFormatter'),
      icon: <CodeOutlined />,
      component: <CFormatter />,
    },
    {
      key: 'escape',
      label: t('escapeTool'),
      icon: <SwapOutlined />,
      component: <EscapeTool />,
    },
  ]

  const menuItems = tools.map(tool => ({
    key: tool.key,
    icon: tool.icon,
    label: tool.label,
  }))

  const currentTool = tools.find(tool => tool.key === selectedTool)

  return (
    <Layout className="tools-tab-container">
      <Sider width={200} theme="dark" className="tools-sidebar">
        <Menu
          mode="inline"
          selectedKeys={[selectedTool]}
          items={menuItems}
          onClick={({ key }) => setSelectedTool(key as ToolType)}
          className="tools-menu"
        />
      </Sider>
      <Content className="tools-content">
        {currentTool?.component}
      </Content>
    </Layout>
  )
}

export default ToolsTab
