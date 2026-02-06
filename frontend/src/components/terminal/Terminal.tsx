import React, { useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { SSHConfigEntry } from '../../types';
import { EventsOn } from '../../../wailsjs/runtime/runtime';
import {
  CloseTerminalSession,
  ResizeTerminal,
  StartTerminalSession,
  WriteToTerminal,
} from '../../../wailsjs/go/main/App';
import './Terminal.css';

interface TerminalProps {
  connection: SSHConfigEntry;
  sessionId: string;
}

const Terminal: React.FC<TerminalProps> = ({ connection, sessionId }) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (!terminalRef.current || !sessionId) {
      return;
    }

    console.log('🖥️ Initializing terminal for session:', sessionId);

    // Create terminal instance
    const term = new XTerm({
      fontSize: 14,
      fontFamily: '"Cascadia Code", "Fira Code", Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#aeafad',
        selection: 'rgba(255, 255, 255, 0.3)',
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
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      tabStopWidth: 4,
      allowTransparency: true,
    });

    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(searchAddon);
    term.loadAddon(webLinksAddon);

    term.open(terminalRef.current);
    fitAddon.fit();
    
    // Focus terminal immediately and ensure it stays focused
    term.focus();
    
    // Add a delayed focus to ensure it takes effect
    setTimeout(() => {
      term.focus();
      console.log('✅ Terminal focused');
    }, 100);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Initialize terminal session
    initializeTerminalSession(term, fitAddon);

    // Handle terminal input
    term.onData((data) => {
      console.log('⌨️ Terminal input:', data.length, 'bytes, sessionId:', sessionId);
      if (!sessionId) {
        console.error('❌ No sessionId, cannot send input');
        return;
      }
      WriteToTerminal(sessionId, data)
        .then(() => {
          console.log('✅ Input sent to backend successfully');
        })
        .catch((err: any) => {
          console.error('❌ Failed to write to terminal:', err);
          term.writeln('\x1b[31mError: failed to write to terminal\x1b[0m');
        });
    });

    // Handle resize
    const handleResize = () => {
      if (fitAddonRef.current && xtermRef.current) {
        fitAddonRef.current.fit();
        const dimensions = fitAddonRef.current.proposeDimensions();
        if (dimensions && sessionId) {
          ResizeTerminal(sessionId, dimensions.rows, dimensions.cols).catch((err: any) => {
            console.error('Failed to resize terminal:', err);
          });
        }
      }
    };

    // Debounce resize handler
    let resizeTimeout: NodeJS.Timeout;
    const debouncedResize = () => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(handleResize, 100);
    };

    window.addEventListener('resize', debouncedResize);

    // Setup event listener for terminal output
    const unsubscribe = EventsOn('terminal:output', (payload: any) => {
      console.log('📥 Received terminal output:', { 
        payloadSessionId: payload.sessionId, 
        currentSessionId: sessionId,
        dataLength: payload.data?.length,
        matches: payload.sessionId === sessionId
      });
      
      if (payload.sessionId === sessionId && payload.data) {
        term.write(payload.data);
        console.log('✍️ Wrote to terminal:', payload.data.length, 'bytes');
      }
    });

    // Cleanup
    return () => {
      unsubscribe();
      window.removeEventListener('resize', debouncedResize);
      clearTimeout(resizeTimeout);
      
      if (sessionId) {
        CloseTerminalSession(sessionId).catch(console.error);
      }
      
      term.dispose();
    };
  }, [connection, sessionId]);

  const initializeTerminalSession = async (term: XTerm, fitAddon: FitAddon) => {
    try {
      if (!sessionId) {
        term.writeln('\x1b[31mError: No session ID provided\x1b[0m');
        return;
      }

      term.writeln('\x1b[32m●\x1b[0m Connecting to \x1b[36m' + connection.host + '\x1b[0m...');

      // Get terminal dimensions
      const dimensions = fitAddon.proposeDimensions();
      if (!dimensions) {
        term.writeln('\x1b[31mError: Could not determine terminal dimensions\x1b[0m');
        return;
      }

      // Start terminal session on backend
      await StartTerminalSession(sessionId, dimensions.rows, dimensions.cols);

      term.writeln('\x1b[32m✓\x1b[0m Connected to \x1b[36m' + connection.user + '@' + connection.host + '\x1b[0m');
      term.writeln('');
      setIsReady(true);

      // Setup output listener using a polling mechanism
      // In production, this should use Wails Events system
      startOutputPolling(term);
    } catch (error: any) {
      console.error('Failed to initialize terminal:', error);
      term.writeln('\x1b[31mError: ' + (error?.message || 'Failed to connect') + '\x1b[0m');
    }
  };

  const startOutputPolling = (term: XTerm) => {
    // Terminal output is now handled via Wails Events system
    // The EventsOn listener above will receive output from backend
    console.log('✅ Terminal output listener setup complete');
  };

  // Add click handler to ensure focus
  const handleTerminalClick = () => {
    if (xtermRef.current) {
      xtermRef.current.focus();
      console.log('🎯 Terminal focused on click');
    }
  };

  return (
    <div 
      className="terminal-wrapper"
      onClick={handleTerminalClick}
      onFocus={() => xtermRef.current?.focus()}
    >
      <div
        ref={terminalRef}
        className="terminal-container"
        onClick={handleTerminalClick}
        tabIndex={0}
      />
      {!isReady && sessionId && (
        <div className="terminal-status">
          Initializing terminal session...
        </div>
      )}
    </div>
  );
};

export default Terminal;
