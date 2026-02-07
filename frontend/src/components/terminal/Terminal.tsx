import React, { useEffect, useRef, useCallback } from 'react'
import { Terminal as XTerm } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'
import { EventsOn } from '../../../wailsjs/runtime/runtime'
import { WriteToTerminal, StartTerminalSession, StartLocalTerminalSession, ResizeTerminal } from '../../../wailsjs/go/app/App'
import { ClipboardGetText, ClipboardSetText } from '../../../wailsjs/runtime/runtime'
import logger from '../../utils/logger'
import './Terminal.css'

interface TerminalProps {
  sessionId: string
  sessionType: 'ssh' | 'local'
  isActive: boolean
  enableSelectToCopy: boolean
  enableRightClickPaste: boolean
}

const Terminal: React.FC<TerminalProps> = ({
  sessionId,
  sessionType,
  isActive,
  enableSelectToCopy,
  enableRightClickPaste,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  // Guard: prevent duplicate startSession calls (React StrictMode / fast re-renders)
  const sessionStartedRef = useRef<string | null>(null)
  // Track whether this terminal tab is currently visible
  const isActiveRef = useRef(isActive)
  // Track the last dimensions sent to the backend to avoid redundant SIGWINCH
  const lastDimensionsRef = useRef<{ rows: number; cols: number } | null>(null)
  // Use refs for settings so event handlers always see the latest values
  const enableSelectToCopyRef = useRef(enableSelectToCopy)
  const enableRightClickPasteRef = useRef(enableRightClickPaste)

  useEffect(() => {
    enableSelectToCopyRef.current = enableSelectToCopy
  }, [enableSelectToCopy])

  useEffect(() => {
    enableRightClickPasteRef.current = enableRightClickPaste
  }, [enableRightClickPaste])

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
    }

    // Create xterm instance with theme
    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#aeafad',
        selection: '#264f78',
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
      // Enable bracketed paste mode for better multiline paste handling
      // This allows shells like zsh to show @zsh (1-5) indicators
      allowTransparency: false,
      macOptionIsMeta: true, // Allow Option key as Meta on macOS
      scrollback: 10000,
    })

    // Create and attach fit addon
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(terminalRef.current)
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
            await StartLocalTerminalSession(sessionId, dimensions.rows, dimensions.cols)
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

    // Handle terminal input
    term.onData((data: string) => {
      WriteToTerminal(sessionId, data).catch((err) => {
        console.error('Failed to write to terminal:', err)
      })
    })

    // Handle keyboard shortcuts for copy/paste
    // IMPORTANT: Only process keydown events to prevent double-firing
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
    const normalizeKey = (value: string) => (value.length === 1 ? value.toLowerCase() : value)
    const isKey = (event: KeyboardEvent, key: string, code: string) =>
      normalizeKey(event.key) === key || event.code === code
    logger.log('🎯 [Terminal] Installing custom key handler, isMac:', isMac);
    
    term.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if (event.type !== 'keydown') return true

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
          (!isMac && event.ctrlKey && isKey(event, 'v', 'KeyV') && !event.metaKey)) {
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
      if (xtermRef.current) {
        xtermRef.current.dispose()
        xtermRef.current = null
      }
      fitAddonRef.current = null
      // NOTE: Do NOT reset sessionStartedRef here!
      // React StrictMode unmount/remount preserves refs — if we reset it,
      // the guard fails and startSession runs twice, creating duplicate PTYs.
    }
  }, [sessionId, sessionType, handleResize])

  // Listen for file drop events dispatched from App-level OnFileDrop
  useEffect(() => {
    if (!isActive) return

    logger.log('🎯 [Terminal] Setting up file drop listener for session:', sessionId)
    
    const handler = (e: Event) => {
      const paths = (e as CustomEvent).detail?.paths as string[]
      logger.log('📥 [Terminal] File drop received, paths:', paths)

      if (!paths || paths.length === 0) {
        logger.log('⚠️ [Terminal] No paths received in drop event')
        return
      }

      // Write each file path to the terminal
      // For multiple files, separate them with spaces (like shell argument list)
      // Escape paths with spaces by wrapping in quotes
      const escapedPaths = paths.map(path => {
        // If path contains spaces, wrap in quotes
        if (path.includes(' ')) {
          return `"${path}"`
        }
        return path
      })
      
      const pathsText = escapedPaths.join(' ')
      
      WriteToTerminal(sessionId, pathsText).catch((err) => {
        console.error('Failed to write file path to terminal:', err)
      })

      logger.log('✅ [Terminal] File paths written to terminal:', pathsText)
    }

    window.addEventListener('app:file-drop-terminal', handler)

    return () => {
      logger.log('🧹 [Terminal] Cleaning up file drop listener')
      window.removeEventListener('app:file-drop-terminal', handler)
    }
  }, [sessionId, isActive])

  return <div ref={terminalRef} className="terminal-container" />
}

export default Terminal
