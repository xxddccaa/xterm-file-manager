import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Input, Spin, Tooltip, message } from 'antd'
import { EditOutlined, MenuOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'

import { GetCommandSnippets, GetCommandSnippetsConfigPath, OpenEditorWindow, WriteLocalFile, WriteToTerminal } from '../../../wailsjs/go/app/App'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { CommandSnippet, filterCommandSnippets, reorderCommandSnippetsByVisibleIds } from '../../utils/commandSnippets'
import './CommandPanel.css'

interface CommandPanelProps {
  sessionId: string
  host: string
  connected: boolean
  isActive: boolean
}

const getErrorMessage = (error: any): string => {
  if (typeof error === 'string') return error
  if (error?.message) return error.message
  return String(error)
}

const CommandPanel: React.FC<CommandPanelProps> = ({
  sessionId,
  host,
  connected,
  isActive,
}) => {
  const { t } = useTranslation('terminal')
  const [snippets, setSnippets] = useState<CommandSnippet[]>([])
  const [searchText, setSearchText] = useState('')
  const [loading, setLoading] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [configPath, setConfigPath] = useState('')
  const [draggedSnippetId, setDraggedSnippetId] = useState<string | null>(null)
  const snippetOrderChangedRef = useRef(false)
  const suppressInsertRef = useRef(false)
  const snippetsRef = useRef<CommandSnippet[]>([])
  const persistedSnippetsRef = useRef<CommandSnippet[]>([])

  useEffect(() => {
    snippetsRef.current = snippets
  }, [snippets])

  const loadSnippets = useCallback(async () => {
    setLoading(true)
    try {
      const snippetsPath = await GetCommandSnippetsConfigPath()
      setConfigPath(snippetsPath)

      const snippetsJSON = await GetCommandSnippets()
      const parsed = JSON.parse(snippetsJSON) as CommandSnippet[]
      const nextSnippets = Array.isArray(parsed) ? parsed : []
      setSnippets(nextSnippets)
      snippetsRef.current = nextSnippets
      persistedSnippetsRef.current = nextSnippets
      setErrorMessage('')
    } catch (error: any) {
      setErrorMessage(getErrorMessage(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isActive) {
      return
    }

    loadSnippets()

    const cleanupConfigChanged = EventsOn('command-snippets:changed', () => {
      loadSnippets()
    })

    return () => {
      cleanupConfigChanged()
    }
  }, [isActive, loadSnippets])

  const filteredSnippets = useMemo(() => {
    return filterCommandSnippets(snippets, searchText)
  }, [searchText, snippets])

  const canDragReorder = !savingOrder && searchText.trim() === '' && snippets.length > 1

  const persistSnippetOrder = useCallback(async (nextSnippets: CommandSnippet[], successMessage?: string) => {
    setSavingOrder(true)

    try {
      const targetPath = configPath || await GetCommandSnippetsConfigPath()
      setConfigPath(targetPath)

      const content = `${JSON.stringify(nextSnippets, null, 2)}\n`
      await WriteLocalFile(targetPath, content)

      persistedSnippetsRef.current = nextSnippets

      if (successMessage) {
        message.success(successMessage)
      }
    } catch (error: any) {
      const previousSnippets = persistedSnippetsRef.current
      setSnippets(previousSnippets)
      snippetsRef.current = previousSnippets
      message.error(t('failedToSaveCommandOrder', { error: getErrorMessage(error) }))
    } finally {
      setSavingOrder(false)
    }
  }, [configPath, t])

  const handleInsertCommand = useCallback(async (snippet: CommandSnippet) => {
    if (suppressInsertRef.current) {
      suppressInsertRef.current = false
      return
    }

    if (!connected) {
      message.warning(t('commandPanelDisconnected'))
      return
    }

    try {
      await WriteToTerminal(sessionId, snippet.command)
    } catch (error: any) {
      message.error(t('commandInsertFailed', { error: getErrorMessage(error) }))
    }
  }, [connected, sessionId, t])

  const handleSnippetDragStart = useCallback((event: React.DragEvent, snippetId: string) => {
    if (!canDragReorder) {
      event.preventDefault()
      return
    }

    setDraggedSnippetId(snippetId)
    snippetOrderChangedRef.current = false
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', snippetId)

    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.style.opacity = '0.55'
    }
  }, [canDragReorder])

  const handleSnippetDragOver = useCallback((event: React.DragEvent, targetId: string) => {
    if (!canDragReorder || !draggedSnippetId || draggedSnippetId === targetId) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'

    setSnippets((prev) => {
      const next = reorderCommandSnippetsByVisibleIds(
        prev,
        draggedSnippetId,
        targetId,
        prev.map((snippet) => snippet.id),
      )

      if (next !== prev) {
        snippetOrderChangedRef.current = true
        snippetsRef.current = next
      }

      return next
    })
  }, [canDragReorder, draggedSnippetId])

  const handleSnippetDragEnd = useCallback(async (event: React.DragEvent) => {
    if (event.currentTarget instanceof HTMLElement) {
      event.currentTarget.style.opacity = '1'
    }

    const orderChanged = snippetOrderChangedRef.current
    snippetOrderChangedRef.current = false
    setDraggedSnippetId(null)

    if (!orderChanged) {
      return
    }

    suppressInsertRef.current = true
    await persistSnippetOrder(snippetsRef.current, t('commandOrderSaved'))
  }, [persistSnippetOrder, t])

  const handleOpenConfig = useCallback(async () => {
    try {
      const nextPath = configPath || await GetCommandSnippetsConfigPath()
      setConfigPath(nextPath)
      await OpenEditorWindow(nextPath, false, '')
    } catch (error: any) {
      message.error(t('commandConfigOpenFailed', { error: getErrorMessage(error) }))
    }
  }, [configPath, t])

  return (
    <div className="command-panel">
      <div className="command-panel-toolbar">
        <Input
          allowClear
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
          prefix={<SearchOutlined />}
          placeholder={t('commandSearchPlaceholder')}
          className="command-panel-search"
        />
        <Tooltip title={t('reloadCommands')}>
          <Button
            type="text"
            icon={<ReloadOutlined />}
            className="command-panel-toolbar-btn"
            onClick={() => { void loadSnippets() }}
          />
        </Tooltip>
        <Tooltip title={configPath || t('commandConfigButton')}>
          <Button
            type="text"
            icon={<EditOutlined />}
            className="command-panel-toolbar-btn"
            onClick={() => { void handleOpenConfig() }}
          />
        </Tooltip>
      </div>

      <div className="command-panel-summary">
        <span>{searchText.trim() ? t('commandSearchHint') : t('commandInsertHint')}</span>
        <span>{t('commandCount', { count: filteredSnippets.length, total: snippets.length })}</span>
      </div>

      {loading ? (
        <div className="command-panel-state">
          <Spin size="small" />
        </div>
      ) : errorMessage ? (
        <div className="command-panel-state command-panel-state-error">
          <div className="command-panel-error-title">{t('failedToLoadCommands')}</div>
          <div className="command-panel-error-text">{errorMessage}</div>
          <div className="command-panel-error-actions">
            <Button size="small" onClick={() => { void loadSnippets() }}>
              {t('reloadCommands')}
            </Button>
            <Button size="small" onClick={() => { void handleOpenConfig() }}>
              {t('commandConfigButton')}
            </Button>
          </div>
        </div>
      ) : filteredSnippets.length === 0 ? (
        <div className="command-panel-state">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={searchText ? t('noCommandMatches') : t('noCommandsConfigured')}
          />
        </div>
      ) : (
        <div className="command-panel-list">
          {filteredSnippets.map((snippet) => (
            <button
              key={snippet.id || `${snippet.title}-${snippet.command}`}
              type="button"
              className={`command-card ${draggedSnippetId === snippet.id ? 'dragging' : ''}`}
              onClick={() => { void handleInsertCommand(snippet) }}
              draggable={canDragReorder}
              onDragStart={(event) => handleSnippetDragStart(event, snippet.id)}
              onDragOver={(event) => handleSnippetDragOver(event, snippet.id)}
              onDragEnd={(event) => { void handleSnippetDragEnd(event) }}
              aria-disabled={!connected}
              title={`${snippet.title}\n${snippet.command}`}
            >
              <div className="command-card-header">
                <span className="command-card-title">{snippet.title}</span>
                <span className="command-card-header-actions">
                  <span className="command-card-action">{t('commandInsertButton')}</span>
                  <span
                    className={`command-card-grip ${canDragReorder ? 'is-draggable' : ''}`}
                    aria-hidden="true"
                  >
                    <MenuOutlined />
                  </span>
                </span>
              </div>
              <code className="command-card-command">{snippet.command}</code>
              {snippet.description && (
                <div className="command-card-description">{snippet.description}</div>
              )}
              {!!snippet.tags?.length && (
                <div className="command-card-tags">
                  {snippet.tags.map((tag) => (
                    <span key={`${snippet.id}-${tag}`} className="command-card-tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {!connected && (
        <div className="command-panel-disconnected">{t('commandPanelDisconnected')}</div>
      )}
      <div className="command-panel-host">{host}</div>
    </div>
  )
}

export default CommandPanel
