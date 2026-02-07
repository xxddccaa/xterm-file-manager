import React, { useState, useEffect, useRef } from 'react';
import {
  FolderOutlined,
  FileOutlined,
  DownloadOutlined,
  ReloadOutlined,
  UploadOutlined,
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
} from '@ant-design/icons';
import { Input, Button, message, Spin, Modal } from 'antd';
import { GetHomeDirectory, ListLocalFiles, OpenEditorWindow, DeleteLocalDirectory, DeleteLocalFile, DownloadFile, RenameLocalFile } from '../../../wailsjs/go/app/App'
import logger from '../../utils/logger'
import './LocalFileManager.css';

interface LocalFile {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modTime: string;
}

interface ContextMenuState {
  visible: boolean;
  x: number;
  y: number;
  file: LocalFile | null;
}

interface LocalFileManagerProps {
  onUploadFile?: (localPath: string, remoteDir: string) => void;
  onDownloadComplete?: () => void;
  sessionId?: string;
  refreshKey?: number;
}

const LocalFileManager: React.FC<LocalFileManagerProps> = ({
  onUploadFile,
  onDownloadComplete,
  sessionId,
  refreshKey,
}) => {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    visible: false,
    x: 0,
    y: 0,
    file: null,
  });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const fileListRef = useRef<HTMLDivElement>(null);
  const [renamingFile, setRenamingFile] = useState<LocalFile | null>(null);
  const [newFileName, setNewFileName] = useState('');
  const renameSubmittedRef = useRef(false);

  useEffect(() => {
    // Get home directory on mount
    GetHomeDirectory()
      .then((homePath: string) => {
        setCurrentPath(homePath);
        setPathInput(homePath);
        loadFiles(homePath);
      })
      .catch((err: any) => {
        console.error('Failed to get home directory:', err);
        message.error('Failed to get home directory');
      });
  }, []);

  // Refresh when refreshKey changes
  useEffect(() => {
    if (refreshKey && refreshKey > 0 && currentPath) {
      loadFiles(currentPath);
    }
  }, [refreshKey]);

  // Close context menu on click outside
  useEffect(() => {
    const handleClick = () => setContextMenu(prev => ({ ...prev, visible: false }));
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
    const normalizeKey = (value: string) => (value.length === 1 ? value.toLowerCase() : value)
    const isKey = (event: KeyboardEvent, key: string, code: string) =>
      normalizeKey(event.key) === key || event.code === code
    const isEditableTarget = (target: EventTarget | null) => {
      if (!target || !(target instanceof HTMLElement)) return false
      const tagName = target.tagName
      return tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable
    }

    logger.log('🎯 [LocalFileManager] Installing keyboard listener, selectedFile:', selectedFile);
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return

      const keyInfo = {
        key: e.key,
        code: e.code,
        ctrl: e.ctrlKey,
        meta: e.metaKey,
        alt: e.altKey,
        shift: e.shiftKey,
        selectedFile,
        target: (e.target as HTMLElement)?.tagName
      };
      
      logger.log('🔑 [LocalFileManager] KeyDown:', keyInfo);

      const isRenameShortcut =
        (e.key === 'F2' || e.code === 'F2') ||
        (isMac && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && isKey(e, 'r', 'KeyR')) ||
        (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey)

      // Rename selected file
      if (isRenameShortcut && selectedFile) {
        logger.log('✅ [LocalFileManager] Rename shortcut pressed with selected file:', selectedFile);
        e.preventDefault();
        e.stopPropagation();
        const file = files.find(f => f.name === selectedFile);
        if (file) {
          logger.log('📝 [LocalFileManager] Opening rename dialog for:', file.name);
          setRenamingFile(file);
          setNewFileName(file.name);
        }
      } else if (isRenameShortcut && !selectedFile) {
        logger.log('⚠️ [LocalFileManager] Rename shortcut pressed but no file selected');
      }
    };

    document.addEventListener('keydown', handleKeyDown, true); // Use capture phase
    return () => {
      logger.log('🎯 [LocalFileManager] Removing keyboard listener');
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [selectedFile, files]);

  const loadFiles = async (path: string) => {
    try {
      setLoading(true);
      if ((window as any).go?.app?.App?.ListLocalFiles) {
        const fileList = await (window as any).go.app.App.ListLocalFiles(path);
        // Sort: directories first, then alphabetically
        const sorted = (fileList || []).sort((a: LocalFile, b: LocalFile) => {
          if (a.isDir && !b.isDir) return -1;
          if (!a.isDir && b.isDir) return 1;
          return a.name.localeCompare(b.name);
        });
        setFiles(sorted);
      }
    } catch (err: any) {
      console.error('Failed to list local files:', err);
      message.error('Failed to list local files: ' + (err?.message || 'Unknown error'));
    } finally {
      setLoading(false);
    }
  };

  const handleNavigate = (filePath: string) => {
    setCurrentPath(filePath);
    setPathInput(filePath);
    loadFiles(filePath);
  };

  const handleFileClick = (file: LocalFile) => {
    // Single click: select (for both files and directories, like Finder/Explorer)
    // Double click: navigate into directory / open file
    setSelectedFile(file.name === selectedFile ? null : file.name);
    fileListRef.current?.focus();
  };

  const handleFileDoubleClick = (file: LocalFile) => {
    if (file.isDir) {
      handleNavigate(file.path);
    } else {
      // Open file in standalone browser editor window
      if ((window as any).go?.app?.App?.OpenEditorWindow) {
        (window as any).go.app.App.OpenEditorWindow(file.path, false, sessionId || '')
          .catch((err: any) => message.error(`Failed to open editor: ${err?.message || err}`));
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent, file: LocalFile) => {
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

  const handleContextMenuEdit = () => {
    if (!contextMenu.file || contextMenu.file.isDir) return;
    setContextMenu(prev => ({ ...prev, visible: false }));
    if ((window as any).go?.app?.App?.OpenEditorWindow) {
      (window as any).go.app.App.OpenEditorWindow(contextMenu.file.path, false, sessionId || '')
        .catch((err: any) => message.error(`Failed to open editor: ${err?.message || err}`));
    }
  };

  const handleContextMenuUpload = () => {
    if (!contextMenu.file || !onUploadFile) return;
    setContextMenu(prev => ({ ...prev, visible: false }));
    // Upload to remote current path. The remote path will be handled by parent.
    onUploadFile(contextMenu.file.path, '~');
  };

  const handleContextMenuDelete = async () => {
    if (!contextMenu.file) return;
    const file = contextMenu.file;
    setContextMenu(prev => ({ ...prev, visible: false }));

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
            if ((window as any).go?.app?.App?.DeleteLocalDirectory) {
              await (window as any).go.app.App.DeleteLocalDirectory(file.path);
              message.success(`Deleted directory: ${file.name}`);
              loadFiles(currentPath);
            }
          } else {
            if ((window as any).go?.app?.App?.DeleteLocalFile) {
              await (window as any).go.app.App.DeleteLocalFile(file.path);
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

  const handleContextMenuRename = () => {
    if (!contextMenu.file) return;
    setRenamingFile(contextMenu.file);
    setNewFileName(contextMenu.file.name);
    setContextMenu(prev => ({ ...prev, visible: false }));
  };

  const handleRename = async () => {
    if (renameSubmittedRef.current) return;
    renameSubmittedRef.current = true;

    const file = renamingFile;
    const name = newFileName.trim();
    setRenamingFile(null);
    setNewFileName('');

    if (!file || !name || name === file.name) {
      setTimeout(() => { renameSubmittedRef.current = false; }, 50);
      return;
    }

    try {
      if ((window as any).go?.app?.App?.RenameLocalFile) {
        await (window as any).go.app.App.RenameLocalFile(file.path, name);
        message.success(`Renamed to: ${name}`);
        loadFiles(currentPath);
      }
    } catch (err: any) {
      message.error(`Rename failed: ${err?.message || err}`);
    } finally {
      setTimeout(() => { renameSubmittedRef.current = false; }, 50);
    }
  };

  const cancelRename = () => {
    renameSubmittedRef.current = true;
    setRenamingFile(null);
    setNewFileName('');
    setTimeout(() => { renameSubmittedRef.current = false; }, 50);
  };

  const handlePathEdit = () => setEditingPath(true);

  const handlePathSubmit = () => {
    setEditingPath(false);
    if (pathInput !== currentPath) {
      handleNavigate(pathInput);
    }
  };

  const handlePathKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handlePathSubmit();
    else if (e.key === 'Escape') {
      setEditingPath(false);
      setPathInput(currentPath);
    }
  };

  const handleRefresh = () => loadFiles(currentPath);

  const goUp = () => {
    if (!currentPath) return;
    const separator = currentPath.includes('\\') ? '\\' : '/';
    const parts = currentPath.split(separator).filter(Boolean);
    if (parts.length > 1) {
      parts.pop();
      const newPath = separator + parts.join(separator);
      handleNavigate(newPath);
    }
  };

  const formatSize = (bytes: number): string => {
    if (bytes === 0) return '-';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

  const handleDropFiles = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const remoteFilePath = e.dataTransfer.getData('remoteFile');
    if (remoteFilePath && sessionId) {
      console.log('📥 Download remote file to local:', remoteFilePath, '->', currentPath);
      // Call backend SFTP download
      try {
        if ((window as any).go?.app?.App?.DownloadFile) {
          message.loading({ content: `Downloading ${remoteFilePath}...`, key: 'download', duration: 0 });
          const result = await (window as any).go.app.App.DownloadFile(
            sessionId,
            remoteFilePath,
            currentPath
          );
          message.success({ content: `Downloaded to ${result}`, key: 'download' });
          loadFiles(currentPath);
          onDownloadComplete?.();
        }
      } catch (err: any) {
        message.error({ content: `Download failed: ${err?.message || err}`, key: 'download' });
      }
    }
  };

  const handleFileDragStart = (e: React.DragEvent, file: LocalFile) => {
    e.dataTransfer.setData('localFile', file.path);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const filteredFiles = showHidden
    ? files
    : files.filter(f => !f.name.startsWith('.'));

  return (
    <div
      className={`local-file-manager ${dragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDropFiles}
    >
      {/* Path input */}
      <div className="path-bar">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={goUp}
          size="small"
          type="text"
          disabled={!currentPath || currentPath === '/'}
        />
        {editingPath ? (
          <Input
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            onBlur={handlePathSubmit}
            onKeyDown={handlePathKeyDown}
            autoFocus
            className="path-input"
          />
        ) : (
          <div
            className="path-display"
            onClick={handlePathEdit}
            title="Click to edit path"
          >
            {currentPath || 'Local Files'}
          </div>
        )}
        <Button
          icon={<ReloadOutlined />}
          onClick={handleRefresh}
          size="small"
          type="text"
        />
      </div>

      {/* File list */}
      <div className="file-list" ref={fileListRef} tabIndex={-1} style={{ outline: 'none' }}>
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
              key={index}
              className={`file-item ${file.isDir ? 'directory' : 'file'} ${
                selectedFile === file.name ? 'selected' : ''
              }`}
              onClick={() => handleFileClick(file)}
              onDoubleClick={() => handleFileDoubleClick(file)}
              onContextMenu={e => handleContextMenu(e, file)}
              draggable={!file.isDir}
              onDragStart={e => handleFileDragStart(e, file)}
            >
              <span className="file-icon-wrapper">
                {file.isDir ? (
                  <FolderOutlined className="icon-folder" />
                ) : (
                  <FileOutlined className="icon-file" />
                )}
              </span>
              {renamingFile?.name === file.name ? (
                <input
                  className="file-name-input"
                  value={newFileName}
                  onChange={e => setNewFileName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      handleRename();
                    } else if (e.key === 'Escape') {
                      cancelRename();
                    }
                    e.stopPropagation();
                  }}
                  onBlur={() => handleRename()}
                  autoFocus
                  onFocus={e => {
                    const val = e.target.value;
                    const dot = val.lastIndexOf('.');
                    if (dot > 0 && !file.isDir) {
                      e.target.setSelectionRange(0, dot);
                    } else {
                      e.target.select();
                    }
                  }}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <span className="file-name-text">{file.name}</span>
              )}
              <span className="file-size-text">
                {file.isDir ? '-' : formatSize(file.size)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Drop overlay */}
      {dragOver && (
        <div className="drop-overlay">
          <DownloadOutlined style={{ fontSize: 36, marginBottom: 12 }} />
          <div>Drop files here to download</div>
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
          {!contextMenu.file.isDir && (
            <div className="context-menu-item" onClick={handleContextMenuEdit}>
              <EditOutlined />
              <span>Edit</span>
            </div>
          )}
          {!contextMenu.file.isDir && onUploadFile && (
            <div className="context-menu-item" onClick={handleContextMenuUpload}>
              <UploadOutlined />
              <span>Upload to remote</span>
            </div>
          )}
          {contextMenu.file.isDir && (
            <div
              className="context-menu-item"
              onClick={() => {
                handleNavigate(contextMenu.file!.path);
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
              handleRefresh();
            }}
          >
            <ReloadOutlined />
            <span>Refresh</span>
          </div>
          <div
            className="context-menu-item"
            onClick={handleContextMenuRename}
          >
            <EditOutlined />
            <span>Rename</span>
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

export default LocalFileManager;
