import React, { useState, useEffect } from 'react'
import { Form, Select, Checkbox, Button, message, Space, Divider, Typography } from 'antd'
import { useTranslation } from 'react-i18next'
import { GetTerminalSettings, SetTerminalSettings } from '../../../wailsjs/go/app/App'
import './SettingsTab.css'

const { Title } = Typography

interface Settings {
  enableSelectToCopy: boolean
  enableRightClickPaste: boolean
  locale: string
}

const SettingsTab: React.FC = () => {
  const { t, i18n } = useTranslation(['settings', 'common'])
  const [settings, setSettings] = useState<Settings>({
    enableSelectToCopy: true,
    enableRightClickPaste: true,
    locale: 'en-US',
  })
  const [loading, setLoading] = useState(false)
  const [loadingSettings, setLoadingSettings] = useState(true)

  // Load settings on mount
  useEffect(() => {
    loadSettings()
  }, [])

  const loadSettings = async () => {
    try {
      const settingsJSON = await GetTerminalSettings()
      const loadedSettings = JSON.parse(settingsJSON)
      setSettings({
        enableSelectToCopy: loadedSettings.enableSelectToCopy ?? true,
        enableRightClickPaste: loadedSettings.enableRightClickPaste ?? true,
        locale: loadedSettings.locale || 'en-US',
      })
    } catch (error) {
      console.error('❌ Failed to load settings:', error)
      message.error(t('settings:loadFailed'))
    } finally {
      setLoadingSettings(false)
    }
  }

  const saveSettings = async () => {
    setLoading(true)
    try {
      await SetTerminalSettings(JSON.stringify(settings))

      // Switch language if changed
      if (i18n.language !== settings.locale) {
        await i18n.changeLanguage(settings.locale)
        console.log(`🌍 [Settings] Language changed to: ${settings.locale}`)
      }

      message.success(t('settings:saveSuccess'))
    } catch (error) {
      console.error('❌ Failed to save settings:', error)
      message.error(t('settings:saveFailed'))
    } finally {
      setLoading(false)
    }
  }

  if (loadingSettings) {
    return <div className="settings-loading">{t('common:loading')}</div>
  }

  return (
    <div className="settings-tab">
      <div className="settings-content">
        <Title level={3}>{t('common:settings')}</Title>

        <Form layout="vertical" style={{ maxWidth: 600 }}>
          {/* General Settings */}
          <Divider orientation="left">{t('settings:general')}</Divider>

          <Form.Item label={t('settings:language')}>
            <Select
              value={settings.locale}
              onChange={(value) => setSettings({ ...settings, locale: value })}
              options={[
                { value: 'en-US', label: 'English' },
                { value: 'zh-CN', label: '简体中文' },
              ]}
              style={{ width: 200 }}
            />
          </Form.Item>

          {/* Terminal Settings */}
          <Divider orientation="left">{t('settings:terminalSettings')}</Divider>

          <Form.Item>
            <Space direction="vertical">
              <Checkbox
                checked={settings.enableSelectToCopy}
                onChange={(e) =>
                  setSettings({ ...settings, enableSelectToCopy: e.target.checked })
                }
              >
                {t('settings:enableSelectToCopy')}
              </Checkbox>
              <Checkbox
                checked={settings.enableRightClickPaste}
                onChange={(e) =>
                  setSettings({ ...settings, enableRightClickPaste: e.target.checked })
                }
              >
                {t('settings:enableRightClickPaste')}
              </Checkbox>
            </Space>
          </Form.Item>

          {/* Save Button */}
          <Form.Item>
            <Button type="primary" onClick={saveSettings} loading={loading}>
              {t('common:save')}
            </Button>
          </Form.Item>
        </Form>
      </div>
    </div>
  )
}

export default SettingsTab
