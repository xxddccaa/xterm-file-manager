import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Breadcrumb, Spin, message, Input, Button, Modal } from 'antd';
import {
  FolderOutlined,
  FileOutlined,
  HomeOutlined,
  ReloadOutlined,
  UploadOutlined,
  DownloadOutlined,
  ArrowLeftOutlined,
  DeleteOutlined,
} from '@ant-design/icons';
import { SSHConfigEntry } from '../../types';
import './FileManager.css';

interface FileInfo {
  name: string;
  size: number;
  mode: string;
  modTime: string;
  isDir: boolean;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  file: FileInfo | null;
}

interface FileManagerProps {
  connection: SSHConfigEntry;
  sessionId: string;
  onPathChange?: (path: string) => void;
  onDownloadFile?: (remotePath: string, localDir: string) => void;
  refreshKey?: number;
}

const FileManager: React.FC<FileManagerProps> = ({
  connection,
  sessionId,
  onPathChange,
  onDownloadFile,
  refreshKey,
}) => {
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [currentPath, setCurrentPath] = useState('~');
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('~');
  const [dragOver, setDragOver] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    file: null,
  });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Resolve ~ to actual remote home directory on initial load
  useEffect(() => {
    if (!sessionId) return;
    const resolveHome = async () => {
      if (currentPath === '~') {
        try {
          if ((window as any).go?.main?.App?.GetRemoteHomeDir) {
            const homeDir = await (window as any).go.main.App.GetRemoteHomeDir(sessionId);
            if (homeDir) {
              const resolved = homeDir.trim();
              console.log('🏠 Resolved remote home dir:', resolved);
              setCurrentPath(resolved);
              setPathInput(resolved);
              return; // setCurrentPath will trigger the next useEffect
            }
          }
        } catch (err) {
          console.warn('Failed to resolve remote home dir, fallback to ~:', err);
        }
      }
    };
    resolveHome();
  }, [sessionId]);

  // Load files when path changes
  useEffect(() => {
    if (!sessionId || currentPath === '~') return;
    loadFiles(currentPath);
    setPathInput(currentPath);
  }, [sessionId, currentPath]);

  // Refresh when refreshKey changes
  useEffect(() => {
    if (refreshKey && refreshKey > 0) {
      loadFiles(currentPath);
    }
  }, [refreshKey]);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(prev => ({ ...prev, visible: false }));
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  const loadFiles = async (path: string) => {
    try {
      setLoading(true);

      if ((window as any).go?.main?.App?.ListFiles) {
        const fileList = await (window as any).go.main.App.ListFiles(sessionId, path);
        // Sort: directories first, then alphabetically
        const sorted = (fileList || []).sort((a: FileInfo, b: FileInfo) => {
          if (a.isDir && !b.isDir) return -1;
          if (!a.isDir && b.isDir) return 1;
          return a.name.localeCompare(b.name);
        });
        setFiles(sorted);
        onPathChange?.(path);
      }
    } catch (error: any) {
      console.error('❌ Failed to load files:', error);
      message.error(`Failed to load files: ${error?.message || error}`);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const handleFileClick = (file: FileInfo) => {
    if (file.isDir) {
      const newPath =
        currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      setCurrentPath(newPath);
    } else {
      setSelectedFile(file.name === selectedFile ? null : file.name);
    }
  };

  const handleFileDoubleClick = (file: FileInfo) => {
    if (file.isDir) {
      const newPath =
        currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
      setCurrentPath(newPath);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, file: FileInfo) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedFile(file.name);
    setContextMenu({
      visible: true,
      x: e.clientX,
      y: e.clientY,
      file,
    });
  };

  const handleContextMenuDownload = async () => {
    if (!contextMenu.file) return;
    setContextMenu(prev => ({ ...prev, visible: false }));

    const file = contextMenu.file;
    const remotePath =
      currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;

    // Get user's home directory as default local download dir
    try {
      let localDir = '';
      if ((window as any).go?.main?.App?.GetHomeDirectory) {
        localDir = await (window as any).go.main.App.GetHomeDirectory();
        localDir = localDir + '/Downloads';
      }
      if (onDownloadFile) {
        onDownloadFile(remotePath, localDir);
      }
    } catch (err: any) {
      message.error(`Download failed: ${err?.message || err}`);
    }
  };

  const handleContextMenuDelete = async () => {
    if (!contextMenu.file) return;
    const file = contextMenu.file;
    setContextMenu(prev => ({ ...prev, visible: false }));

    const remotePath =
      currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;

    // Confirm deletion
    Modal.confirm({
      title: `Delete ${file.isDir ? 'directory' : 'file'}?`,
      content: `Are you sure you want to delete "${file.name}"? This action cannot be undone.`,
      okText: 'Delete',
      okType: 'danger',
      cancelText: 'Cancel',
      onOk: async () => {
        try {
          if (file.isDir) {
            if ((window as any).go?.main?.App?.DeleteRemoteDirectory) {
              await (window as any).go.main.App.DeleteRemoteDirectory(sessionId, remotePath);
              message.success(`Deleted directory: ${file.name}`);
              loadFiles(currentPath);
            }
          } else {
            if ((window as any).go?.main?.App?.DeleteRemoteFile) {
              await (window as any).go.main.App.DeleteRemoteFile(sessionId, remotePath);
              message.success(`Deleted file: ${file.name}`);
              loadFiles(currentPath);
            }
          }
        } catch (err: any) {
          message.error(`Delete failed: ${err?.message || err}`);
        }
      },
    });
  };

  const goUp = () => {
    if (currentPath === '~' || currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    if (parts.length > 1) {
      parts.pop();
      setCurrentPath('/' + parts.join('/'));
    } else {
      setCurrentPath('/');
    }
  };

  const handleBreadcrumbClick = (index: number) => {
    const parts = currentPath.split('/').filter(Boolean);
    if (index === -1) {
      setCurrentPath('~');
    } else {
      const newPath = '/' + parts.slice(0, index + 1).join('/');
      setCurrentPath(newPath);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '-';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const handlePathEdit = () => setEditingPath(true);

  const handlePathSubmit = () => {
    setEditingPath(false);
    if (pathInput !== currentPath) {
      setCurrentPath(pathInput);
    }
  };

  const handlePathKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handlePathSubmit();
    else if (e.key === 'Escape') {
      setEditingPath(false);
      setPathInput(currentPath);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const localFile = e.dataTransfer.getData('localFile');
    if (localFile) {
      console.log('📤 Upload local file to remote:', localFile, '->', currentPath);
      // Call upload via SFTP
      try {
        if ((window as any).go?.main?.App?.UploadFile) {
          message.loading({ content: `Uploading ${localFile}...`, key: 'upload', duration: 0 });
          const result = await (window as any).go.main.App.UploadFile(sessionId, localFile, currentPath);
          message.success({ content: `Uploaded to ${result}`, key: 'upload' });
          loadFiles(currentPath);
        }
      } catch (err: any) {
        message.error({ content: `Upload failed: ${err?.message || err}`, key: 'upload' });
      }
    }
  };

  const handleFileDragStart = (e: React.DragEvent, file: FileInfo) => {
    const fullPath =
      currentPath === '/' ? `/${file.name}` : `${currentPath}/${file.name}`;
    e.dataTransfer.setData('remoteFile', fullPath);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const filteredFiles = showHidden
    ? files
    : files.filter(f => !f.name.startsWith('.'));

  const pathParts =
    currentPath === '~' ? [] : currentPath.split('/').filter(Boolean);

  return (
    <div
      className={`file-manager-container ${dragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Path input bar */}
      <div className="path-bar">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={goUp}
          size="small"
          type="text"
          disabled={currentPath === '~' || currentPath === '/'}
        />
        {editingPath ? (
          <Input
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            onBlur={handlePathSubmit}
            onKeyDown={handlePathKeyDown}
            autoFocus
            className="path-input"
            placeholder="Enter remote path..."
          />
        ) : (
          <div
            className="path-display"
            onClick={handlePathEdit}
            title="Click to edit path"
          >
            {currentPath}
          </div>
        )}
        <Button
          icon={<ReloadOutlined />}
          onClick={() => loadFiles(currentPath)}
          size="small"
          type="text"
        />
      </div>

      {/* File list */}
      <div className="file-list-content">
        {loading ? (
          <div className="file-list-empty">
            <Spin size="small" />
            <span style={{ marginLeft: 8 }}>Loading...</span>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="file-list-empty">Empty directory</div>
        ) : (
          filteredFiles.map((file, index) => (
            <div
              key={`${file.name}-${index}`}
              className={`file-item ${file.isDir ? 'directory' : 'file'} ${
                selectedFile === file.name ? 'selected' : ''
              }`}
              onClick={() => handleFileClick(file)}
              onDoubleClick={() => handleFileDoubleClick(file)}
              onContextMenu={e => handleContextMenu(e, file)}
              draggable
              onDragStart={e => handleFileDragStart(e, file)}
            >
              <span className="file-icon-wrapper">
                {file.isDir ? (
                  <FolderOutlined className="icon-folder" />
                ) : (
                  <FileOutlined className="icon-file" />
                )}
              </span>
              <span className="file-name-text">{file.name}</span>
              <span className="file-size-text">
                {file.isDir ? '-' : formatSize(file.size)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Drag overlay */}
      {dragOver && (
        <div className="drop-overlay">
          <UploadOutlined style={{ fontSize: 36, marginBottom: 12 }} />
          <div>Drop files here to upload</div>
        </div>
      )}

      {/* Context Menu */}
      {contextMenu.visible && contextMenu.file && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
        >
          <div className="context-menu-item" onClick={handleContextMenuDownload}>
            <DownloadOutlined />
            <span>Download to local</span>
          </div>
          {contextMenu.file.isDir && (
            <div
              className="context-menu-item"
              onClick={() => {
                const file = contextMenu.file!;
                const newPath =
                  currentPath === '/'
                    ? `/${file.name}`
                    : `${currentPath}/${file.name}`;
                setCurrentPath(newPath);
                setContextMenu(prev => ({ ...prev, visible: false }));
              }}
            >
              <FolderOutlined />
              <span>Open directory</span>
            </div>
          )}
          <div
            className="context-menu-item"
            onClick={() => {
              setContextMenu(prev => ({ ...prev, visible: false }));
              loadFiles(currentPath);
            }}
          >
            <ReloadOutlined />
            <span>Refresh</span>
          </div>
          <div className="context-menu-divider" />
          <div className="context-menu-item danger" onClick={handleContextMenuDelete}>
            <DeleteOutlined />
            <span>Delete</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default FileManager;
