import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { GetTerminalSettings } from '../../wailsjs/go/app/App'

// Import language resources
import enCommon from './locales/en-US/common.json'
import enTerminal from './locales/en-US/terminal.json'
import enEditor from './locales/en-US/editor.json'
import enSync from './locales/en-US/sync.json'
import enFiles from './locales/en-US/files.json'
import enTools from './locales/en-US/tools.json'
import enSettings from './locales/en-US/settings.json'

import zhCommon from './locales/zh-CN/common.json'
import zhTerminal from './locales/zh-CN/terminal.json'
import zhEditor from './locales/zh-CN/editor.json'
import zhSync from './locales/zh-CN/sync.json'
import zhFiles from './locales/zh-CN/files.json'
import zhTools from './locales/zh-CN/tools.json'
import zhSettings from './locales/zh-CN/settings.json'

// Load user locale from backend settings
async function loadUserLocale(): Promise<string> {
  try {
    const settingsJSON = await GetTerminalSettings()
    const settings = JSON.parse(settingsJSON)
    return settings.locale || 'en-US'
  } catch (error) {
    console.error('❌ [i18n] Failed to load user locale:', error)
    return 'en-US'
  }
}

// Initialize i18next
i18n
  .use(initReactI18next)
  .init({
    resources: {
      'en-US': {
        common: enCommon,
        terminal: enTerminal,
        editor: enEditor,
        sync: enSync,
        files: enFiles,
        tools: enTools,
        settings: enSettings,
      },
      'zh-CN': {
        common: zhCommon,
        terminal: zhTerminal,
        editor: zhEditor,
        sync: zhSync,
        files: zhFiles,
        tools: zhTools,
        settings: zhSettings,
      },
    },
    fallbackLng: 'en-US',
    lng: 'en-US', // Default, will be overridden after loading from backend
    ns: ['common', 'terminal', 'editor', 'sync', 'files', 'tools', 'settings'],
    defaultNS: 'common',
    interpolation: {
      escapeValue: false, // React already escapes
    },
  })

// Load user locale on initialization
loadUserLocale().then(locale => {
  if (i18n.language !== locale) {
    i18n.changeLanguage(locale)
    console.log(`🌍 [i18n] Language set to: ${locale}`)
  }
})

export default i18n
