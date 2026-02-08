import React, { useEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { ConfigProvider, theme } from 'antd'
import enUS from 'antd/locale/en_US'
import zhCN from 'antd/locale/zh_CN'
import { useTranslation } from 'react-i18next'
import App from './App'
import './i18n' // Initialize i18n
import './App.css'

const AppWithI18n: React.FC = () => {
  const { i18n } = useTranslation()
  const [antdLocale, setAntdLocale] = useState(enUS)

  useEffect(() => {
    // Update Ant Design locale when i18n language changes
    const updateLocale = () => {
      setAntdLocale(i18n.language === 'zh-CN' ? zhCN : enUS)
    }

    updateLocale() // Initialize
    i18n.on('languageChanged', updateLocale)

    return () => {
      i18n.off('languageChanged', updateLocale)
    }
  }, [i18n])

  return (
    <ConfigProvider 
      theme={{ algorithm: theme.darkAlgorithm }}
      locale={antdLocale}
    >
      <App />
    </ConfigProvider>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppWithI18n />
  </React.StrictMode>,
)
