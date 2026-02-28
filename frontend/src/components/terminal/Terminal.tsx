import React, { useEffect, useRef, useCallback, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { SearchAddon } from '@xterm/addon-search'
import { CanvasAddon } from '@xterm/addon-canvas'
import { WebglAddon } from '@xterm/addon-webgl'
import { ImageAddon, IImageAddonOptions } from '@xterm/addon-image'
import '@xterm/xterm/css/xterm.css'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { WriteToTerminal, StartTerminalSession, StartLocalTerminalSession, ResizeTerminal } from '../../../wailsjs/go/app/App'
import { ClipboardGetText, ClipboardSetText } from '../../../wailsjs/runtime/runtime'
import logger from '../../utils/logger'
import { escapeShellPaths } from '../../utils/shellEscape'
import './Terminal.css'

interface TerminalProps {
  sessionId: string
  sessionType: 'ssh' | 'local'
  isActive: boolean
  enableSelectToCopy: boolean
  enableRightClickPaste: boolean
  initialDir?: string  // Optional initial working directory for local terminals
}

const Terminal: React.FC<TerminalProps> = ({
  sessionId,
  sessionType,
  isActive,
  enableSelectToCopy,
  enableRightClickPaste,
  initialDir = '',
}) => {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const searchAddonRef = useRef<SearchAddon | null>(null)
  // Guard: prevent duplicate startSession calls (React StrictMode / fast re-renders)
  const sessionStartedRef = useRef<string | null>(null)
  // Track whether this terminal tab is currently visible
  const isActiveRef = useRef(isActive)
  // Track the last dimensions sent to the backend to avoid redundant SIGWINCH
  const lastDimensionsRef = useRef<{ rows: number; cols: number } | null>(null)
  // Use refs for settings so event handlers always see the latest values
  const enableSelectToCopyRef = useRef(enableSelectToCopy)
  const enableRightClickPasteRef = useRef(enableRightClickPaste)

  // Search bar state
  const [searchVisible, setSearchVisible] = useState(false)
  const [searchText, setSearchText] = useState('')
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
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      // Open URL in default browser
      window.open(uri, '_blank')
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

    // 6. GPU-accelerated renderer: try WebGL first, fallback to Canvas
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

    // Handle terminal input
    term.onData((data: string) => {
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
    logger.log('🎯 [Terminal] Installing custom key handler, isMac:', isMac);
    
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
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
          logger.log('✅ [Terminal] Cmd+C detected, copying selection');
          event.preventDefault()
          ClipboardSetText(selection).catch((err) => {
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
          logger.log('✅ [Terminal] Ctrl+Shift+C detected, copying selection');
          event.preventDefault()
          ClipboardSetText(selection).catch((err) => {
            logger.log('❌ [Terminal] Failed to copy:', err);
          })
          return false
        }
      }
      
      // Handle Ctrl+Shift+V (Linux/Windows terminal convention) - paste
      if (!isMac && event.ctrlKey && event.shiftKey && isKey(event, 'v', 'KeyV')) {
        logger.log('✅ [Terminal] Ctrl+Shift+V paste detected');
        event.preventDefault()
        ClipboardGetText().then((text) => {
          if (text) {
            // Detect if this is multiline content
            const hasMultipleLines = text.includes('\n') || text.includes('\r')
            
            if (hasMultipleLines) {
              // For multiline paste: use bracketed paste mode
              const trimmedText = text.replace(/[\r\n]+$/, '')
              const bracketedText = '\x1b[200~' + trimmedText + '\x1b[201~'
              WriteToTerminal(sessionId, bracketedText).catch((err) => {
                console.error('Failed to paste to terminal:', err)
              })
            } else {
              // Single line paste: just strip trailing whitespace
              const trimmedText = text.replace(/[\r\n]+$/, '')
              WriteToTerminal(sessionId, trimmedText).catch((err) => {
                console.error('Failed to paste to terminal:', err)
              })
            }
          }
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
          // Has selection: Copy to clipboard (works on all platforms)
          logger.log('📋 [Terminal] Copying to clipboard');
          event.preventDefault()
          ClipboardSetText(selection).catch((err) => {
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

      // Handle Cmd+V (Mac) / Ctrl+V (other) for paste
      // For multiline paste, preserve internal newlines but strip trailing ones
      if ((isMac && event.metaKey && isKey(event, 'v', 'KeyV') && !event.ctrlKey) ||
          (isMac && event.ctrlKey && isKey(event, 'v', 'KeyV') && !event.metaKey) ||
          (!isMac && event.ctrlKey && isKey(event, 'v', 'KeyV') && !event.metaKey && !event.shiftKey)) {
        logger.log('✅ [Terminal] Paste shortcut detected');
        event.preventDefault()
        ClipboardGetText().then((text) => {
          if (text) {
            // Detect if this is multiline content
            const hasMultipleLines = text.includes('\n') || text.includes('\r')
            
            if (hasMultipleLines) {
              // For multiline paste: use bracketed paste mode
              // This allows shells like zsh to show @zsh (1-5) indicators
              // Strip only trailing newlines to prevent auto-execution
              const trimmedText = text.replace(/[\r\n]+$/, '')
              
              // Send with bracketed paste escape sequences
              // \x1b[200~ starts bracketed paste, \x1b[201~ ends it
              const bracketedText = '\x1b[200~' + trimmedText + '\x1b[201~'
              WriteToTerminal(sessionId, bracketedText).catch((err) => {
                console.error('Failed to paste to terminal:', err)
              })
            } else {
              // Single line paste: just strip trailing whitespace
              const trimmedText = text.replace(/[\r\n]+$/, '')
              WriteToTerminal(sessionId, trimmedText).catch((err) => {
                console.error('Failed to paste to terminal:', err)
              })
            }
          }
        }).catch((err) => {
          console.error('Failed to get clipboard text:', err)
        })
        return false
      }

      // On Mac, let Ctrl+[key] shortcuts pass through to terminal
      // This allows Ctrl+A, Ctrl+D, Ctrl+E, Ctrl+K, Ctrl+U, Ctrl+Z, etc. to work properly
      if (isMac && event.ctrlKey && !event.metaKey && !event.altKey && !isKey(event, 'c', 'KeyC')) {
        logger.log('✅ [Terminal] Ctrl+' + normalizeKey(event.key).toUpperCase() + ' passing through to terminal');
        return true // Let terminal handle Ctrl shortcuts (except Ctrl+C which we handled above)
      }

      // Allow all other keys to pass through to terminal
      return true
    })

    // Handle selection change for auto-copy (uses ref for latest setting)
    const handleSelectionChange = () => {
      if (enableSelectToCopyRef.current) {
        const selection = term.getSelection()
        if (selection) {
          ClipboardSetText(selection).catch((err) => {
            console.error('Failed to copy to clipboard:', err)
          })
        }
      }
    }
    term.onSelectionChange(handleSelectionChange)

    // Handle right-click for paste (uses ref for latest setting)
    // Mimics macOS Terminal behavior: paste without auto-executing
    const handleContextMenu = async (e: MouseEvent) => {
      if (enableRightClickPasteRef.current) {
        e.preventDefault()
        e.stopPropagation()

        try {
          const text = await ClipboardGetText()
          if (text) {
            // Detect if this is multiline content
            const hasMultipleLines = text.includes('\n') || text.includes('\r')
            
            if (hasMultipleLines) {
              // For multiline paste: use bracketed paste mode
              // Strip only trailing newlines to prevent auto-execution
              const trimmedText = text.replace(/[\r\n]+$/, '')
              
              // Send with bracketed paste escape sequences
              const bracketedText = '\x1b[200~' + trimmedText + '\x1b[201~'
              await WriteToTerminal(sessionId, bracketedText)
            } else {
              // Single line paste: just strip trailing whitespace
              const trimmedText = text.replace(/[\r\n]+$/, '')
              await WriteToTerminal(sessionId, trimmedText)
            }
          }
        } catch (err) {
          console.error('Failed to paste from clipboard:', err)
        }
      }
    }

    const terminalElement = terminalRef.current
    terminalElement.addEventListener('contextmenu', handleContextMenu)

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
      terminalElement.removeEventListener('contextmenu', handleContextMenu)
      cleanupEvents()
      cleanupDisconnect()
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
  }, [sessionId, sessionType, handleResize])

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
    </div>
  )
}

export default Terminal
