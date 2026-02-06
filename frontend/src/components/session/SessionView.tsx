import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Spin, Alert, Button, message } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import Terminal from '../terminal/Terminal';
import FileManager from '../file-manager/FileManager';
import LocalFileManager from '../file-manager/LocalFileManager';
import { main } from '../../../wailsjs/go/models'
type SSHConfigEntry = main.SSHConfigEntry
import './SessionView.css';

interface SessionViewProps {
  sessionId: string;
  config: SSHConfigEntry;
  onClose: () => void;
  onConnectionChange?: (connected: boolean) => void;
}

const SessionView: React.FC<SessionViewProps> = ({ sessionId, config, onClose, onConnectionChange }) => {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState('~');
  const [backendSessionId, setBackendSessionId] = useState<string>('');

  // Pane widths in percentage (terminal, remote, local)
  // Terminal gets more space (50%), file managers get less (25% each)
  const [paneWidths, setPaneWidths] = useState<[number, number, number]>([50, 25, 25]);
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<number | null>(null); // which divider: 0 = between terminal & remote, 1 = between remote & local
  const startXRef = useRef(0);
  const startWidthsRef = useRef<[number, number, number]>([50, 25, 25]);

  // Refresh triggers for file panels
  const [remoteRefreshKey, setRemoteRefreshKey] = useState(0);
  const [localRefreshKey, setLocalRefreshKey] = useState(0);

  useEffect(() => {
    connectToServer();
    // Note: SSH connection cleanup is now handled only when explicitly closing the tab
    // We don't disconnect on component unmount to keep connections alive when switching tabs
    return () => {
      // No automatic disconnect - connections persist across tab switches
      // Disconnect is only triggered when user clicks the close button (via handleDisconnect)
    };
  }, [sessionId, config]);

  const connectToServer = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('🔌 Connecting to server:', config);

      if ((window as any).go?.app?.App?.ConnectSSH) {
        const sid = await (window as any).go.app.App.ConnectSSH(config);
        console.log('✅ Connected! Backend Session ID:', sid);
        setBackendSessionId(sid);
        setConnected(true);
        onConnectionChange?.(true);
      } else {
        throw new Error('SSH connection method not available');
      }
    } catch (err: any) {
      console.error('❌ Connection failed:', err);
      setError(err?.message || 'Failed to connect');
      setConnected(false);
      onConnectionChange?.(false);
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      if (backendSessionId && (window as any).go?.app?.App?.DisconnectSSH) {
        await (window as any).go.app.App.DisconnectSSH(backendSessionId);
      }
      onConnectionChange?.(false);
      onClose();
    } catch (err) {
      console.error('Failed to disconnect:', err);
      onConnectionChange?.(false);
      onClose();
    }
  };

  // --- Draggable divider logic ---
  const handleMouseDown = useCallback((dividerIndex: number, e: React.MouseEvent) => {
    e.preventDefault();
    draggingRef.current = dividerIndex;
    startXRef.current = e.clientX;
    startWidthsRef.current = [...paneWidths] as [number, number, number];
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [paneWidths]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (draggingRef.current === null || !containerRef.current) return;

      const containerWidth = containerRef.current.getBoundingClientRect().width;
      const deltaX = e.clientX - startXRef.current;
      const deltaPercent = (deltaX / containerWidth) * 100;

      const newWidths: [number, number, number] = [...startWidthsRef.current] as [number, number, number];
      const divider = draggingRef.current;
      const minWidth = 15; // minimum 15%

      if (divider === 0) {
        // Dragging between terminal and remote
        newWidths[0] = startWidthsRef.current[0] + deltaPercent;
        newWidths[1] = startWidthsRef.current[1] - deltaPercent;
      } else {
        // Dragging between remote and local
        newWidths[1] = startWidthsRef.current[1] + deltaPercent;
        newWidths[2] = startWidthsRef.current[2] - deltaPercent;
      }

      // Enforce minimum widths
      if (newWidths[0] >= minWidth && newWidths[1] >= minWidth && newWidths[2] >= minWidth) {
        setPaneWidths(newWidths);
      }
    };

    const handleMouseUp = () => {
      if (draggingRef.current !== null) {
        draggingRef.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // --- SFTP transfer handlers ---
  const handleDownloadToLocal = async (remotePath: string, localDir: string) => {
    try {
      message.loading({ content: `Downloading ${remotePath}...`, key: 'transfer', duration: 0 });
      if ((window as any).go?.app?.App?.DownloadFile) {
        const result = await (window as any).go.app.App.DownloadFile(backendSessionId, remotePath, localDir);
        message.success({ content: `Downloaded to ${result}`, key: 'transfer' });
        setLocalRefreshKey(k => k + 1);
      }
    } catch (err: any) {
      message.error({ content: `Download failed: ${err?.message || err}`, key: 'transfer' });
    }
  };

  const handleUploadToRemote = async (localPath: string, remoteDir: string) => {
    try {
      message.loading({ content: `Uploading ${localPath}...`, key: 'transfer', duration: 0 });
      if ((window as any).go?.app?.App?.UploadFile) {
        const result = await (window as any).go.app.App.UploadFile(backendSessionId, localPath, remoteDir);
        message.success({ content: `Uploaded to ${result}`, key: 'transfer' });
        setRemoteRefreshKey(k => k + 1);
      }
    } catch (err: any) {
      message.error({ content: `Upload failed: ${err?.message || err}`, key: 'transfer' });
    }
  };

  if (loading) {
    return (
      <div className="session-loading">
        <Spin size="large" />
        <p>Connecting to {config.host}...</p>
      </div>
    );
  }

  if (error || !connected) {
    return (
      <div className="session-error">
        <Alert
          message="Connection Failed"
          description={error || 'Failed to connect to server'}
          type="error"
          showIcon
        />
        <div className="error-actions">
          <Button icon={<ReloadOutlined />} onClick={connectToServer}>
            Retry Connection
          </Button>
          <Button onClick={handleDisconnect}>Close Session</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="session-view">
      <div className="session-split-pane" ref={containerRef}>
        {/* Left: Terminal */}
        <div 
          className="terminal-pane" 
          style={{ 
            flexGrow: paneWidths[0], 
            flexShrink: 1, 
            flexBasis: 0 
          }}
        >
          <div className="pane-header">
            <span className="pane-title">Terminal</span>
            <span className="pane-info">{config.user}@{config.host}</span>
          </div>
          <div className="pane-content">
            <Terminal connection={config} sessionId={backendSessionId} />
          </div>
        </div>

        {/* Divider 1 */}
        <div 
          className="split-divider"
          onMouseDown={(e) => handleMouseDown(0, e)}
        />

        {/* Middle: Remote File Manager */}
        <div 
          className="file-manager-pane" 
          style={{ 
            flexGrow: paneWidths[1], 
            flexShrink: 1, 
            flexBasis: 0 
          }}
        >
          <div className="pane-header">
            <span className="pane-title">Remote Files</span>
            <span className="pane-info">{config.host}</span>
          </div>
          <div className="pane-content">
            <FileManager
              connection={config}
              sessionId={backendSessionId}
              onPathChange={setCurrentPath}
              onDownloadFile={handleDownloadToLocal}
              refreshKey={remoteRefreshKey}
            />
          </div>
        </div>

        {/* Divider 2 */}
        <div 
          className="split-divider"
          onMouseDown={(e) => handleMouseDown(1, e)}
        />

        {/* Right: Local File Manager */}
        <div 
          className="local-files-pane" 
          style={{ 
            flexGrow: paneWidths[2], 
            flexShrink: 1, 
            flexBasis: 0 
          }}
        >
          <div className="pane-header">
            <span className="pane-title">Local Files</span>
            <span className="pane-info">localhost</span>
          </div>
          <div className="pane-content">
            <LocalFileManager
              onUploadFile={handleUploadToRemote}
              onDownloadComplete={() => setLocalRefreshKey(k => k + 1)}
              sessionId={backendSessionId}
              refreshKey={localRefreshKey}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default SessionView;
