import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { CanvasAddon } from '@xterm/addon-canvas'
import { WebglAddon } from '@xterm/addon-webgl'
import { ImageAddon, IImageAddonOptions } from '@xterm/addon-image'
import { useTranslation } from 'react-i18next'
import '@xterm/xterm/css/xterm.css'
import { BrowserOpenURL, EventsOn } from '../../../wailsjs/runtime/runtime'
import { WriteToTerminal, StartTerminalSession, StartLocalTerminalSession, ResizeTerminal, GetSSHServerInfo } from '../../../wailsjs/go/app/App'
import { ClipboardGetText, ClipboardSetText } from '../../../wailsjs/runtime/runtime'
import { app } from '../../../wailsjs/go/models'
import logger from '../../utils/logger'
import { getTerminalRendererMode } from '../../utils/terminalRenderer'
import { resolveTerminalCopyText } from './terminalCopy'
import { isDeferredTextBeforeInput, shouldDeferMacPunctuationToBeforeInput } from './terminalIme'
import './Terminal.css'

interface TerminalProps {
  sessionId: string
  sessionType: 'ssh' | 'local'
  isActive: boolean
  connected?: boolean
  enableSelectToCopy: boolean
  enableRightClickPaste: boolean
  initialDir?: string  // Optional initial working directory for local terminals
}

type SSHServerInfo = app.SSHServerInfo

const SERVER_INFO_REFRESH_MS = 5000

const isEditableCopyTarget = (target: EventTarget | null, terminalElement: HTMLElement): boolean => {
  if (!(target instanceof Element)) {
    return false
  }

  if (terminalElement.contains(target)) {
    return false
  }

  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return true
  }

  return Boolean(target.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], .monaco-editor'))
}

const isNodeInsideTerminal = (node: Node | null, terminalElement: HTMLElement): boolean => {
  if (!node) {
    return false
  }

  if (node instanceof Element) {
    return terminalElement.contains(node)
  }

  return Boolean(node.parentElement && terminalElement.contains(node.parentElement))
}

const hasExternalDomSelection = (selection: Selection | null, terminalElement: HTMLElement): boolean => {
  if (!selection || selection.isCollapsed || !selection.toString()) {
    return false
  }

  if (
    isNodeInsideTerminal(selection.anchorNode, terminalElement) ||
    isNodeInsideTerminal(selection.focusNode, terminalElement)
  ) {
    return false
  }

  if (selection.rangeCount > 0) {
    const commonAncestor = selection.getRangeAt(0).commonAncestorContainer
    if (isNodeInsideTerminal(commonAncestor, terminalElement)) {
      return false
    }
  }

  return true
}

const formatBytes = (bytes?: number | null): string => {
  if (!bytes || bytes <= 0) return '--'

  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  const digits = value >= 100 || unitIndex === 0 ? 0 : 1
  return `${value.toFixed(digits)} ${units[unitIndex]}`
}

const formatRate = (bytesPerSecond?: number | null): string => {
  if (bytesPerSecond == null || bytesPerSecond < 0) return '--'
  return `${formatBytes(bytesPerSecond)}/s`
}

const formatUsage = (used?: number | null, total?: number | null): string => {
  if (!total || total <= 0) return '--'
  return `${formatBytes(used)} / ${formatBytes(total)}`
}

const formatUptime = (seconds?: number | null): string => {
  if (!seconds || seconds <= 0) return '--'

  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

const formatServerInfoTitle = (label: string, value: string): string => `${label}: ${value}`

const Terminal: React.FC<TerminalProps> = ({
  sessionId,
  sessionType,
  isActive,
  connected = true,
  enableSelectToCopy,
  enableRightClickPaste,
  initialDir = '',
}) => {
  const { t } = useTranslation('terminal')
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  const selectionSnapshotRef = useRef('')
  const selectionSnapshotAtRef = useRef(0)
  // Guard: prevent duplicate startSession calls (React StrictMode / fast re-renders)
  const sessionStartedRef = useRef<string | null>(null)
  // Track whether this terminal tab is currently visible
  const isActiveRef = useRef(isActive)
  // Track the last dimensions sent to the backend to avoid redundant SIGWINCH
  const lastDimensionsRef = useRef<{ rows: number; cols: number } | null>(null)
  // Use refs for settings so event handlers always see the latest values
  const enableSelectToCopyRef = useRef(enableSelectToCopy)
  const enableRightClickPasteRef = useRef(enableRightClickPaste)
  const hoveredLinkUriRef = useRef<string | null>(null)
  const deferredMacPunctuationRef = useRef<{
    code: string
    fallbackText: string
  } | null>(null)

  // Search bar state
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchText, setSearchText] = useState('')
  const [serverInfo, setServerInfo] = useState<SSHServerInfo | null>(null)
  const [serverInfoLoading, setServerInfoLoading] = useState(false)
  const [serverInfoError, setServerInfoError] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    enableSelectToCopyRef.current = enableSelectToCopy
  }, [enableSelectToCopy])

  useEffect(() => {
    enableRightClickPasteRef.current = enableRightClickPaste
  }, [enableRightClickPaste])

  // Focus search input when it becomes visible
  useEffect(() => {
    if (searchVisible && searchInputRef.current) {
      searchInputRef.current.focus()
      // If there's existing search text, select it for easy replacement
      searchInputRef.current.select()
    }
  }, [searchVisible])

  // Perform search when searchText changes
  useEffect(() => {
    if (!searchAddonRef.current) return
    if (searchText) {
      searchAddonRef.current.findNext(searchText)
    } else {
      searchAddonRef.current.clearDecorations()
    }
  }, [searchText])

  const handleSearchNext = useCallback(() => {
    if (searchAddonRef.current && searchText) {
      searchAddonRef.current.findNext(searchText)
    }
  }, [searchText])

  const handleSearchPrev = useCallback(() => {
    if (searchAddonRef.current && searchText) {
      searchAddonRef.current.findPrevious(searchText)
    }
  }, [searchText])

  const handleSearchClose = useCallback(() => {
    setSearchVisible(false)
    if (searchAddonRef.current) {
      searchAddonRef.current.clearDecorations()
    }
    // Re-focus terminal
    if (xtermRef.current) {
      xtermRef.current.focus()
    }
  }, [])

  useEffect(() => {
    if (sessionType !== 'ssh' || !connected) {
      setServerInfo(null)
      setServerInfoLoading(false)
      setServerInfoError('')
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const pollServerInfo = async (isInitialLoad: boolean) => {
      if (isInitialLoad) {
        setServerInfoLoading(true)
      }

      try {
        const info = await GetSSHServerInfo(sessionId)
        if (cancelled) return

        setServerInfo(info)
        setServerInfoError('')
      } catch (error) {
        if (cancelled) return

        const errorMessage = error instanceof Error ? error.message : String(error)
        const normalizedMessage = errorMessage.toLowerCase()
        if (normalizedMessage.includes('session not connected') || normalizedMessage.includes('session not found')) {
          setServerInfo(null)
          setServerInfoError('')
          return
        }

        logger.log('⚠️ [Terminal] Failed to load SSH server info:', errorMessage)
        setServerInfoError(errorMessage)
      } finally {
        if (!cancelled) {
          if (isInitialLoad) {
            setServerInfoLoading(false)
          }
          timer = setTimeout(() => {
            void pollServerInfo(false)
          }, SERVER_INFO_REFRESH_MS)
        }
      }
    }

    void pollServerInfo(true)

    return () => {
      cancelled = true
      if (timer) {
        clearTimeout(timer)
      }
    }
  }, [connected, sessionId, sessionType])

  const writePastedTextToTerminal = useCallback(async (text: string) => {
    if (!text) return

    const hasMultipleLines = text.includes('\n') || text.includes('\r')
    const trimmedText = text.replace(/[\r\n]+$/, '')
    if (!trimmedText) return

    if (hasMultipleLines) {
      const bracketedText = '\x1b[200~' + trimmedText + '\x1b[201~'
      await WriteToTerminal(sessionId, bracketedText)
      return
    }

    await WriteToTerminal(sessionId, trimmedText)
  }, [sessionId])

  const readClipboardText = useCallback(async () => {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
      try {
        return await navigator.clipboard.readText()
      } catch (err) {
        logger.log('⚠️ [Terminal] navigator.clipboard.readText() failed, falling back to Wails runtime clipboard')
      }
    }

    return ClipboardGetText()
  }, [])

  const writeClipboardText = useCallback(async (text: string) => {
    if (!text) return false

    try {
      const success = await ClipboardSetText(text)
      if (success) {
        return true
      }
    } catch (err) {
      logger.log('⚠️ [Terminal] ClipboardSetText failed, falling back to navigator.clipboard.writeText')
    }

    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch (err) {
        logger.log('❌ [Terminal] navigator.clipboard.writeText() failed:', err)
      }
    }

    return false
  }, [])

  const copyTextToClipboard = useCallback(async (text: string, copyEvent?: ClipboardEvent) => {
    if (!text) return false

    let copiedViaNativeEvent = false
    if (copyEvent?.clipboardData) {
      copyEvent.clipboardData.setData('text/plain', text)
      copyEvent.preventDefault()
      copyEvent.stopPropagation()
      copiedViaNativeEvent = true
    }

    const copiedViaApi = await writeClipboardText(text)
    return copiedViaNativeEvent || copiedViaApi
  }, [writeClipboardText])

  const rememberTerminalSelection = useCallback((selection: string) => {
    if (!selection) return

    selectionSnapshotRef.current = selection
    selectionSnapshotAtRef.current = Date.now()
  }, [])

  const openTerminalLink = useCallback((uri: string) => {
    if (!uri) return

    try {
      BrowserOpenURL(uri)
    } catch (err) {
      logger.log('⚠️ [Terminal] BrowserOpenURL failed, falling back to window.open:', err)
      window.open(uri, '_blank', 'noopener,noreferrer')
    }
  }, [])

  const decodeOsc52Text = useCallback((data: string) => {
    const separatorIndex = data.indexOf(';')
    if (separatorIndex === -1) {
      return null
    }

    const clipboardPayload = data.slice(separatorIndex + 1).replace(/\s+/g, '')
    if (!clipboardPayload || clipboardPayload === '?') {
      return null
    }

    const padding = clipboardPayload.length % 4
    const paddedPayload = padding === 0
      ? clipboardPayload
      : clipboardPayload.padEnd(clipboardPayload.length + (4 - padding), '=')

    try {
      const binary = atob(paddedPayload)
      const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))

      // Guard against unexpectedly large clipboard writes from terminal apps.
      if (bytes.length > 1024 * 1024) {
        logger.log('⚠️ [Terminal] OSC 52 payload too large, ignoring clipboard write')
        return null
      }

      return new TextDecoder('utf-8').decode(bytes)
    } catch (err) {
      logger.log('❌ [Terminal] Failed to decode OSC 52 clipboard payload:', err)
      return null
    }
  }, [])

  // Debounced resize handler to avoid rapid-fire resize calls
  const resizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleResize = useCallback(() => {
    if (resizeTimerRef.current) {
      clearTimeout(resizeTimerRef.current)
    }
    resizeTimerRef.current = setTimeout(() => {
      if (fitAddonRef.current && xtermRef.current) {
        try {
          // Only resize when this terminal tab is active — avoids wasted work
          // for hidden tabs and prevents SIGWINCH flickering on tab switch
          if (!isActiveRef.current) return

          fitAddonRef.current.fit()
          const dimensions = fitAddonRef.current.proposeDimensions()
          if (dimensions) {
            const last = lastDimensionsRef.current
            // Only send ResizeTerminal when dimensions actually changed
            if (!last || last.rows !== dimensions.rows || last.cols !== dimensions.cols) {
              lastDimensionsRef.current = { rows: dimensions.rows, cols: dimensions.cols }
              ResizeTerminal(sessionId, dimensions.rows, dimensions.cols).catch((err) => {
                console.error('Failed to resize terminal:', err)
              })
            }
          }
        } catch (e) {
          // Ignore resize errors during cleanup
        }
      }
    }, 50)
  }, [sessionId])

  // Keep isActive ref in sync with prop – MUST come after handleResize definition
  useEffect(() => {
    isActiveRef.current = isActive
    // When this tab becomes active: focus the terminal and trigger a resize
    // in case the window was resized while this terminal was hidden
    if (isActive && xtermRef.current) {
      xtermRef.current.focus()
      handleResize()
    }
  }, [isActive, handleResize])

  useEffect(() => {
    if (!terminalRef.current) return

    // Clean up previous instance if exists
    if (xtermRef.current) {
      xtermRef.current.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
      searchAddonRef.current = null
    }

    // Create xterm instance with theme
    const term = new XTerm({
      allowProposedApi: true,  // Required by @xterm/addon-image and other proposed APIs
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#aeafad',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
      rightClickSelectsWord: false,
      disableStdin: false,
      allowTransparency: false,
      macOptionIsMeta: navigator.platform.toUpperCase().indexOf('MAC') >= 0,
      scrollback: 10000,
    })

    // --- Load addons ---

    // 1. Fit addon: auto-resize terminal to container
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)

    // 2. Unicode11 addon: correct emoji & CJK wide character width
    const unicode11Addon = new Unicode11Addon()
    term.loadAddon(unicode11Addon)
    term.unicode.activeVersion = '11'

    // 3. Web Links addon: clickable URLs in terminal output
    const webLinksAddon = new WebLinksAddon((_event, uri) => {
      openTerminalLink(uri)
    }, {
      hover: (_event, uri) => {
        hoveredLinkUriRef.current = uri
      },
      leave: () => {
        hoveredLinkUriRef.current = null
      },
    })
    term.loadAddon(webLinksAddon)

    // 4. Search addon: Cmd/Ctrl+F terminal search
    const searchAddon = new SearchAddon()
    term.loadAddon(searchAddon)
    searchAddonRef.current = searchAddon

    // 5. Image addon: inline image display (sixel, iTerm2 protocol)
    const imageAddon = new ImageAddon({
      sixelSupport: true,
      sixelScrolling: true,
      sixelPaletteLimit: 4096,
      enableSizeReports: true,
      showPlaceholder: true,
    } as IImageAddonOptions)
    term.loadAddon(imageAddon)

    // Open terminal in DOM
    term.open(terminalRef.current)

    const oscHandlerDisposables: Array<{ dispose: () => void }> = []

    // Support OSC 52 clipboard writes from terminal apps like opencode, tmux,
    // neovim plugins, etc. Without this, apps may report "Copied to clipboard"
    // but the host application never forwards the text to the system clipboard.
    oscHandlerDisposables.push(term.parser.registerOscHandler(52, (data: string) => {
      const clipboardText = decodeOsc52Text(data)
      if (!clipboardText) {
        logger.log('⚠️ [Terminal] Ignoring empty/unsupported OSC 52 clipboard request')
        return true
      }

      void writeClipboardText(clipboardText).then((success) => {
        if (success) {
          logger.log('✅ [Terminal] OSC 52 clipboard write succeeded')
        } else {
          logger.log('❌ [Terminal] OSC 52 clipboard write failed')
        }
      })

      return true
    }))

    const rendererMode = getTerminalRendererMode({
      sessionType,
      platform: navigator.platform,
      userAgent: navigator.userAgent,
    })

    // 6. GPU-accelerated renderer: try WebGL first, fallback to Canvas.
    // Keep the built-in DOM renderer on platforms where embedded webviews have
    // shown rendering issues or repaint artifacts.
    if (rendererMode === 'accelerated') {
      try {
        const webglAddon = new WebglAddon()
        webglAddon.onContextLoss(() => {
          logger.log('⚠️ [Terminal] WebGL context lost, falling back to Canvas renderer')
          webglAddon.dispose()
          try {
            term.loadAddon(new CanvasAddon())
            logger.log('✅ [Terminal] Canvas renderer loaded as fallback')
          } catch (canvasErr) {
            logger.log('⚠️ [Terminal] Canvas renderer also failed, using default DOM renderer')
          }
        })
        term.loadAddon(webglAddon)
        logger.log('✅ [Terminal] WebGL renderer loaded')
      } catch (webglErr) {
        logger.log('⚠️ [Terminal] WebGL renderer unavailable, trying Canvas...')
        try {
          term.loadAddon(new CanvasAddon())
          logger.log('✅ [Terminal] Canvas renderer loaded')
        } catch (canvasErr) {
          logger.log('⚠️ [Terminal] Canvas renderer also failed, using default DOM renderer')
        }
      }
    } else {
      logger.log(`🧱 [Terminal] Using DOM renderer for ${sessionType} terminal (${navigator.platform})`)
    }

    fitAddon.fit()

    xtermRef.current = term
    fitAddonRef.current = fitAddon

    // Start terminal session (with guard against duplicate calls)
    const startSession = async () => {
      // Prevent duplicate startSession for the same sessionId
      if (sessionStartedRef.current === sessionId) {
        console.log(`⚠️ Terminal session ${sessionId} already started, skipping duplicate`)
        return
      }
      sessionStartedRef.current = sessionId

      try {
        const dimensions = fitAddon.proposeDimensions()
        if (dimensions) {
          // Record the initial dimensions so the first ResizeObserver callback
          // won't send a redundant ResizeTerminal with the same values
          lastDimensionsRef.current = { rows: dimensions.rows, cols: dimensions.cols }
          if (sessionType === 'local') {
            await StartLocalTerminalSession(sessionId, dimensions.rows, dimensions.cols, initialDir || '')
          } else {
            await StartTerminalSession(sessionId, dimensions.rows, dimensions.cols)
          }
        }
      } catch (error) {
        console.error('Failed to start terminal session:', error)
        // Reset guard on error so retry is possible
        sessionStartedRef.current = null
      }
    }

    startSession()

    // Listen for terminal output
    const cleanupEvents = EventsOn('terminal:output', (payload: any) => {
      if (payload && payload.sessionId === sessionId && payload.data) {
        term.write(payload.data)
      }
    })

    // Listen for terminal disconnection
    const cleanupDisconnect = EventsOn('terminal:disconnected', (payload: any) => {
      if (payload && payload.sessionId === sessionId) {
        term.writeln('\r\n\x1b[31m[Session disconnected: ' + (payload.reason || 'Unknown reason') + ']\x1b[0m')
      }
    })

    const clearDeferredMacPunctuation = (reason?: string) => {
      const pendingPunctuation = deferredMacPunctuationRef.current
      if (!pendingPunctuation) {
        return
      }

      if (reason) {
        logger.log('✅ [Terminal] Clearing deferred macOS punctuation:', reason)
      }

      deferredMacPunctuationRef.current = null
    }

    // Handle terminal input
    term.onData((data: string) => {
      if (deferredMacPunctuationRef.current && data) {
        clearDeferredMacPunctuation(`native xterm data "${data}"`)
      }

      WriteToTerminal(sessionId, data).catch((err) => {
        console.error('Failed to write to terminal:', err)
      })
    })

    // Handle keyboard shortcuts for copy/paste
    // IMPORTANT: Only process keydown events to prevent double-firing
    // Use modern platform detection (navigator.userAgent fallback for compatibility)
    const isMac = (() => {
      if (typeof navigator !== 'undefined') {
        // Try modern API first
        const userAgentData = (navigator as any).userAgentData
        if (userAgentData && userAgentData.platform) {
          return userAgentData.platform.toUpperCase().indexOf('MAC') >= 0
        }
        // Fallback to deprecated navigator.platform
        return navigator.platform.toUpperCase().indexOf('MAC') >= 0
      }
      return false
    })()
    const normalizeKey = (value: string) => (value.length === 1 ? value.toLowerCase() : value)
    const isKey = (event: KeyboardEvent, key: string, code: string) =>
      normalizeKey(event.key) === key || event.code === code
    const getCtrlLetterSequence = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return null
      }
      if (!event.code.startsWith('Key') || event.code.length !== 4) {
        return null
      }

      const upperChar = event.code.slice(3)
      const charCode = upperChar.charCodeAt(0)
      if (charCode < 65 || charCode > 90) {
        return null
      }

      return String.fromCharCode(charCode - 64)
    }
    logger.log('🎯 [Terminal] Installing custom key handler, isMac:', isMac);
    
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const pendingPunctuation = deferredMacPunctuationRef.current
      const matchesPendingPunctuation = pendingPunctuation &&
        event.key.length === 1 &&
        (pendingPunctuation.code === event.code || pendingPunctuation.fallbackText === event.key)

      if (matchesPendingPunctuation && event.type !== 'keydown') {
        return false
      }

      if (shouldDeferMacPunctuationToBeforeInput(isMac, event)) {
        if (event.type === 'keydown') {
          deferredMacPunctuationRef.current = {
            code: event.code,
            fallbackText: event.key,
          }
          logger.log('🎯 [Terminal] Deferring macOS punctuation to native input path:', {
            key: event.key,
            code: event.code,
          })
          return false
        }
      }

      if (event.type !== 'keydown') return true

      // CRITICAL: Skip all processing during IME composition (Chinese/Japanese/Korean input)
      // During IME composition, keydown events fire with isComposing=true and keyCode=229.
      // We must let xterm.js internal CompositionHelper handle these events without
      // any interference from our custom handler, otherwise Chinese input becomes garbled.
      if (event.isComposing || event.keyCode === 229) {
        return true
      }

      const keyInfo = {
        type: event.type,
        key: event.key,
        code: event.code,
        ctrl: event.ctrlKey,
        meta: event.metaKey,
        alt: event.altKey,
        shift: event.shiftKey,
        selection: term.getSelection() ? 'has selection' : 'no selection'
      };
      
      logger.log('🖥️ [Terminal] KeyEvent:', keyInfo);

      // Handle Cmd+F (Mac) / Ctrl+F (other) - toggle search bar
      if ((isMac && event.metaKey && isKey(event, 'f', 'KeyF') && !event.ctrlKey) ||
          (!isMac && event.ctrlKey && isKey(event, 'f', 'KeyF') && !event.metaKey)) {
        event.preventDefault()
        setSearchVisible(prev => !prev)
        return false
      }

      // Handle Escape - close search bar if visible
      if (event.key === 'Escape') {
        // Let the search bar's own onKeyDown handle it if search is visible
        // Only intercept if we need to close it from terminal context
      }

      // Handle Cmd+C (Mac) - copy if selection, otherwise send interrupt (SIGINT)
      // Mac users naturally use Cmd+C like Ctrl+C on Linux/Windows
      if (isMac && event.metaKey && isKey(event, 'c', 'KeyC') && !event.ctrlKey) {
        const selection = term.getSelection()
        if (selection) {
          rememberTerminalSelection(selection)
          logger.log('✅ [Terminal] Cmd+C detected, copying selection');
          event.preventDefault()
          copyTextToClipboard(selection).catch((err) => {
            logger.log('❌ [Terminal] Failed to copy:', err);
          })
          return false
        }
        // No selection: send Ctrl+C interrupt to terminal
        logger.log('⚠️ [Terminal] Cmd+C detected, no selection → sending interrupt (\\x03)');
        event.preventDefault()
        WriteToTerminal(sessionId, '\x03').catch((err) => {
          console.error('Failed to send Ctrl+C to terminal:', err)
        })
        return false
      }

      // Handle Cmd+D (Mac) - send EOF signal, same as Ctrl+D
      if (isMac && event.metaKey && isKey(event, 'd', 'KeyD') && !event.ctrlKey) {
        logger.log('✅ [Terminal] Cmd+D detected, sending EOF (\\x04)');
        event.preventDefault()
        WriteToTerminal(sessionId, '\x04').catch((err) => {
          console.error('Failed to send Ctrl+D to terminal:', err)
        })
        return false
      }
      
      // Handle Ctrl+Shift+C (Linux/Windows terminal convention) - copy
      if (!isMac && event.ctrlKey && event.shiftKey && isKey(event, 'c', 'KeyC')) {
        const selection = term.getSelection()
        if (selection) {
          rememberTerminalSelection(selection)
          logger.log('✅ [Terminal] Ctrl+Shift+C detected, copying selection');
          event.preventDefault()
          copyTextToClipboard(selection).catch((err) => {
            logger.log('❌ [Terminal] Failed to copy:', err);
          })
          return false
        }
      }
      
      // Handle Ctrl+Shift+V (Linux/Windows terminal convention) - paste
      // Browsers usually do not trigger a native paste event for this shortcut,
      // so we read from the clipboard API directly here.
      if (!isMac && event.ctrlKey && event.shiftKey && isKey(event, 'v', 'KeyV')) {
        logger.log('✅ [Terminal] Ctrl+Shift+V paste detected');
        event.preventDefault()
        readClipboardText().then((text) => {
          return writePastedTextToTerminal(text)
        }).catch((err) => {
          console.error('Failed to get clipboard text:', err)
        })
        return false
      }
      
      // Handle Ctrl+C - different behavior on Mac vs other platforms
      if (event.ctrlKey && isKey(event, 'c', 'KeyC') && !event.metaKey && !event.shiftKey) {
        const selection = term.getSelection()
        logger.log('✅ [Terminal] Ctrl+C detected, selection:', selection ? 'YES' : 'NO');
        if (selection) {
          rememberTerminalSelection(selection)
          // Has selection: Copy to clipboard (works on all platforms)
          logger.log('📋 [Terminal] Copying to clipboard');
          event.preventDefault()
          copyTextToClipboard(selection).catch((err) => {
            logger.log('❌ [Terminal] Failed to copy:', err);
          })
          return false
        }
        // No selection: Send Ctrl+C interrupt to terminal explicitly
        logger.log('⚠️ [Terminal] Sending Ctrl+C interrupt to terminal');
        event.preventDefault()
        WriteToTerminal(sessionId, '\x03').catch((err) => {
          console.error('Failed to send Ctrl+C to terminal:', err)
        })
        return false
      }

      // Handle Ctrl+D - send EOF explicitly
      if (event.ctrlKey && isKey(event, 'd', 'KeyD') && !event.metaKey && !event.shiftKey) {
        logger.log('✅ [Terminal] Ctrl+D detected, sending EOF');
        event.preventDefault()
        WriteToTerminal(sessionId, '\x04').catch((err) => {
          console.error('Failed to send Ctrl+D to terminal:', err)
        })
        return false
      }

      // Let the browser/xterm native paste event handle the standard paste shortcut.
      // This preserves UTF-8 clipboard content from external apps on macOS.
      if ((isMac && event.metaKey && isKey(event, 'v', 'KeyV') && !event.ctrlKey) ||
          (!isMac && event.ctrlKey && isKey(event, 'v', 'KeyV') && !event.metaKey && !event.shiftKey)) {
        logger.log('✅ [Terminal] Standard paste shortcut detected, waiting for native paste event');
        return true
      }

      // macOS Ctrl+V is not a browser-native paste shortcut, but the app previously
      // supported it explicitly, so keep that behavior with UTF-8 safe clipboard read.
      if (isMac && event.ctrlKey && isKey(event, 'v', 'KeyV') && !event.metaKey) {
        logger.log('✅ [Terminal] Ctrl+V paste detected on macOS');
        event.preventDefault()
        readClipboardText().then((text) => {
          return writePastedTextToTerminal(text)
        }).catch((err) => {
          console.error('Failed to get clipboard text:', err)
        })
        return false
      }

      // On macOS WKWebView, some Ctrl+letter combinations can be swallowed by the
      // hidden textarea before xterm.js turns them into control characters. Send
      // the ASCII control byte ourselves so tmux/readline shortcuts stay reliable.
      const ctrlLetterSequence = isMac ? getCtrlLetterSequence(event) : null
      if (ctrlLetterSequence && !isKey(event, 'c', 'KeyC') && !isKey(event, 'd', 'KeyD') && !isKey(event, 'v', 'KeyV')) {
        logger.log('✅ [Terminal] Sending macOS Ctrl+' + event.code.slice(3) + ' as control sequence');
        event.preventDefault()
        WriteToTerminal(sessionId, ctrlLetterSequence).catch((err) => {
          console.error('Failed to send control sequence to terminal:', err)
        })
        return false
      }

      // Let xterm.js handle the remaining macOS Ctrl shortcuts, especially
      // non-letter sequences like Ctrl+[ / Ctrl+\ / Ctrl+].
      if (isMac && event.ctrlKey && !event.metaKey && !event.altKey && !isKey(event, 'c', 'KeyC')) {
        logger.log('✅ [Terminal] Ctrl+' + normalizeKey(event.key).toUpperCase() + ' passing through to terminal');
        return true // Let terminal handle Ctrl shortcuts (except Ctrl+C which we handled above)
      }

      // Allow all other keys to pass through to terminal
      return true
    })

    // Handle selection change for auto-copy (uses ref for latest setting)
    const handleSelectionChange = () => {
      const selection = term.getSelection()
      if (selection) {
        rememberTerminalSelection(selection)
      }

      if (enableSelectToCopyRef.current) {
        if (selection) {
          copyTextToClipboard(selection).catch((err) => {
            console.error('Failed to copy to clipboard:', err)
          })
        }
      }
    }
    term.onSelectionChange(handleSelectionChange)

    // Handle right-click for paste (uses ref for latest setting)
    // Mimics macOS Terminal behavior: paste without auto-executing
    const handleContextMenu = async (e: MouseEvent) => {
      const selection = term.getSelection()
      if (isMac && e.ctrlKey && hoveredLinkUriRef.current) {
        e.preventDefault()
        e.stopPropagation()
        logger.log('✅ [Terminal] Ctrl+click opening hovered link:', hoveredLinkUriRef.current)
        openTerminalLink(hoveredLinkUriRef.current)
        return
      }

      if (isMac && selection) {
        e.preventDefault()
        e.stopPropagation()
        rememberTerminalSelection(selection)
        copyTextToClipboard(selection).then((success) => {
          if (success) {
            logger.log('✅ [Terminal] Context menu copied current selection')
          } else {
            logger.log('❌ [Terminal] Context menu copy failed')
          }
        }).catch((err) => {
          console.error('Failed to copy terminal selection:', err)
        })
        return
      }

      if (enableRightClickPasteRef.current) {
        e.preventDefault()
        e.stopPropagation()

        try {
          const text = await readClipboardText()
          await writePastedTextToTerminal(text)
        } catch (err) {
          console.error('Failed to paste from clipboard:', err)
        }
      }
    }

    const terminalElement = terminalRef.current
    const handleDeferredMacPunctuationBeforeInput = (event: InputEvent) => {
      const pendingPunctuation = deferredMacPunctuationRef.current
      if (!pendingPunctuation || !isDeferredTextBeforeInput(event.inputType, event.data)) {
        return
      }

      logger.log('✅ [Terminal] Observed macOS punctuation beforeinput:', event.data)
    }
    const handleDeferredMacPunctuationInput = (event: InputEvent) => {
      const pendingPunctuation = deferredMacPunctuationRef.current
      if (!pendingPunctuation || !isDeferredTextBeforeInput(event.inputType, event.data)) {
        return
      }

      clearDeferredMacPunctuation(`native input "${event.data}"`)
    }
    const handleDeferredMacPunctuationBlur = () => {
      clearDeferredMacPunctuation('blur')
    }
    const handleNativeCopy = (e: ClipboardEvent) => {
      const currentSelection = term.getSelection()
      if (currentSelection) {
        rememberTerminalSelection(currentSelection)
      }

      const domSelection = window.getSelection?.() || null
      const copyText = resolveTerminalCopyText({
        isActive: isActiveRef.current,
        currentSelection,
        hasTerminalSelection: term.hasSelection(),
        cachedSelection: selectionSnapshotRef.current,
        cachedSelectionAgeMs: Date.now() - selectionSnapshotAtRef.current,
        hasExternalDomSelection: hasExternalDomSelection(domSelection, terminalElement),
        isEditableTarget: isEditableCopyTarget(e.target, terminalElement) || isEditableCopyTarget(document.activeElement, terminalElement),
      })

      if (!copyText) return

      copyTextToClipboard(copyText, e).catch((err) => {
        console.error('Failed to handle native copy event:', err)
      })
    }

    const handleNativePaste = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain')
      if (!text) return

      e.preventDefault()
      e.stopPropagation()
      writePastedTextToTerminal(text).catch((err) => {
        console.error('Failed to paste to terminal:', err)
      })
    }

    terminalElement.addEventListener('beforeinput', handleDeferredMacPunctuationBeforeInput, true)
    terminalElement.addEventListener('input', handleDeferredMacPunctuationInput, true)
    terminalElement.addEventListener('blur', handleDeferredMacPunctuationBlur, true)
    terminalElement.addEventListener('contextmenu', handleContextMenu)
    document.addEventListener('copy', handleNativeCopy, true)
    terminalElement.addEventListener('paste', handleNativePaste, true)

    // Listen to window resize
    window.addEventListener('resize', handleResize)

    // Use ResizeObserver to detect container size changes
    // (e.g. sidebar toggle, tab switch, layout changes)
    const resizeObserver = new ResizeObserver(() => {
      handleResize()
    })
    resizeObserver.observe(terminalElement)

    return () => {
      if (resizeTimerRef.current) {
        clearTimeout(resizeTimerRef.current)
      }
      window.removeEventListener('resize', handleResize)
      resizeObserver.disconnect()
      clearDeferredMacPunctuation()
      terminalElement.removeEventListener('beforeinput', handleDeferredMacPunctuationBeforeInput, true)
      terminalElement.removeEventListener('input', handleDeferredMacPunctuationInput, true)
      terminalElement.removeEventListener('blur', handleDeferredMacPunctuationBlur, true)
      terminalElement.removeEventListener('contextmenu', handleContextMenu)
      document.removeEventListener('copy', handleNativeCopy, true)
      terminalElement.removeEventListener('paste', handleNativePaste, true)
      oscHandlerDisposables.forEach((disposable) => disposable.dispose())
      cleanupEvents()
      cleanupDisconnect()
      hoveredLinkUriRef.current = null
      if (xtermRef.current) {
        xtermRef.current.dispose()
        xtermRef.current = null
      }
      fitAddonRef.current = null
      searchAddonRef.current = null
      // NOTE: Do NOT reset sessionStartedRef here!
      // React StrictMode unmount/remount preserves refs — if we reset it,
      // the guard fails and startSession runs twice, creating duplicate PTYs.
    }
  }, [sessionId, sessionType, copyTextToClipboard, decodeOsc52Text, handleResize, openTerminalLink, readClipboardText, rememberTerminalSelection, writeClipboardText, writePastedTextToTerminal])

  const shouldShowServerInfo = sessionType === 'ssh' && connected
  const systemSummary = serverInfo
    ? [serverInfo.distro, serverInfo.kernel, serverInfo.architecture].filter(Boolean).join(' · ') || '--'
    : '--'
  const cpuSummary = serverInfo
    ? [`${serverInfo.cpuCores || '--'}C`, serverInfo.cpuModel].filter(Boolean).join(' · ') || '--'
    : '--'
  const memorySummary = serverInfo
    ? formatUsage(serverInfo.memoryUsedBytes, serverInfo.memoryTotalBytes)
    : '--'
  const diskSummary = serverInfo
    ? formatUsage(serverInfo.diskUsedBytes, serverInfo.diskTotalBytes)
    : '--'
  const loadSummary = serverInfo?.loadAverage1 || '--'
  const uptimeSummary = serverInfo ? formatUptime(serverInfo.uptimeSeconds) : '--'
  const networkSummary = serverInfo
    ? `${serverInfo.networkInterface || '--'} ↓ ${serverInfo.networkRateReady ? formatRate(serverInfo.networkRxBytesPerSec) : t('serverInfoSampling')} ↑ ${serverInfo.networkRateReady ? formatRate(serverInfo.networkTxBytesPerSec) : t('serverInfoSampling')}`
    : '--'

  return (
    <div className="terminal-wrapper">
      {/* Search bar overlay */}
      {searchVisible && (
        <div className="terminal-search-bar">
          <input
            ref={searchInputRef}
            className="terminal-search-input"
            type="text"
            placeholder="Search..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (e.shiftKey) {
                  handleSearchPrev()
                } else {
                  handleSearchNext()
                }
              }
              if (e.key === 'Escape') {
                handleSearchClose()
              }
              e.stopPropagation()
            }}
          />
          <button className="terminal-search-btn" onClick={handleSearchPrev} title="Previous (Shift+Enter)">▲</button>
          <button className="terminal-search-btn" onClick={handleSearchNext} title="Next (Enter)">▼</button>
          <button className="terminal-search-btn terminal-search-close" onClick={handleSearchClose} title="Close (Esc)">✕</button>
        </div>
      )}
      <div
        ref={terminalRef}
        className="terminal-container"
      />
      {shouldShowServerInfo && (
        <div className="terminal-server-info-bar">
          {serverInfoLoading && !serverInfo ? (
            <div className="terminal-server-info-status">
              {t('serverInfoLoading')}
            </div>
          ) : serverInfo ? (
            <div className="terminal-server-info-grid">
              <div className="server-info-pill" title={formatServerInfoTitle(t('serverInfoSystem'), systemSummary)}>
                <span className="server-info-label" title={t('serverInfoSystem')}>{t('serverInfoSystem')}</span>
                <span className="server-info-value" title={systemSummary}>{systemSummary}</span>
              </div>
              <div className="server-info-pill" title={formatServerInfoTitle(t('serverInfoCpu'), cpuSummary)}>
                <span className="server-info-label" title={t('serverInfoCpu')}>{t('serverInfoCpu')}</span>
                <span className="server-info-value" title={cpuSummary}>{cpuSummary}</span>
              </div>
              <div className="server-info-pill" title={formatServerInfoTitle(t('serverInfoMemory'), memorySummary)}>
                <span className="server-info-label" title={t('serverInfoMemory')}>{t('serverInfoMemory')}</span>
                <span className="server-info-value" title={memorySummary}>{memorySummary}</span>
              </div>
              <div className="server-info-pill" title={formatServerInfoTitle(t('serverInfoDisk'), diskSummary)}>
                <span className="server-info-label" title={t('serverInfoDisk')}>{t('serverInfoDisk')}</span>
                <span className="server-info-value" title={diskSummary}>{diskSummary}</span>
              </div>
              <div className="server-info-pill" title={formatServerInfoTitle(t('serverInfoNetwork'), networkSummary)}>
                <span className="server-info-label" title={t('serverInfoNetwork')}>{t('serverInfoNetwork')}</span>
                <span className="server-info-value" title={networkSummary}>{networkSummary}</span>
              </div>
              <div className="server-info-pill" title={formatServerInfoTitle(t('serverInfoLoad'), loadSummary)}>
                <span className="server-info-label" title={t('serverInfoLoad')}>{t('serverInfoLoad')}</span>
                <span className="server-info-value" title={loadSummary}>{loadSummary}</span>
              </div>
              <div className="server-info-pill" title={formatServerInfoTitle(t('serverInfoUptime'), uptimeSummary)}>
                <span className="server-info-label" title={t('serverInfoUptime')}>{t('serverInfoUptime')}</span>
                <span className="server-info-value" title={uptimeSummary}>{uptimeSummary}</span>
              </div>
            </div>
          ) : (
            <div className="terminal-server-info-status terminal-server-info-status-error">
              {serverInfoError ? t('serverInfoUnavailable') : t('serverInfoLoading')}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Terminal
