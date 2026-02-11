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
  CopyOutlined,
} from '@ant-design/icons';
import { Input, Button, message, Spin, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { GetHomeDirectory, ListLocalFiles, OpenEditorWindow, DeleteLocalDirectory, DeleteLocalFile, DownloadFile, RenameLocalFile, CopyFilesToSystemClipboard } from '../../../wailsjs/go/app/App'
import logger from '../../utils/logger'
import { setDragPayload, getDragPayload, clearDragPayload } from '../../utils/dragState'
import { setDragTarget } from '../../utils/dragState'
import { dlog } from '../../utils/debugLog'
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
  const { t } = useTranslation(['files', 'common']);
  const [currentPath, setCurrentPath] = useState<string>('');
  const [files, setFiles] = useState<LocalFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [showHidden, setShowHidden] = useState(true);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [lastClickedFile, setLastClickedFile] = useState<string | null>(null);
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
        message.error(t('files:failedToGetHomeDir'));
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

    logger.log('🎯 [LocalFileManager] Installing keyboard listener, selectedFiles:', [...selectedFiles]);
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return

      const isRenameShortcut =
        (e.key === 'F2' || e.code === 'F2') ||
        (isMac && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && isKey(e, 'r', 'KeyR')) ||
        (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey)

      // Rename: only works when exactly one file is selected
      const singleSelected = selectedFiles.size === 1 ? [...selectedFiles][0] : null;
      if (isRenameShortcut && singleSelected) {
        logger.log('✅ [LocalFileManager] Rename shortcut pressed with selected file:', singleSelected);
        e.preventDefault();
        e.stopPropagation();
        const file = files.find(f => f.name === singleSelected);
        if (file) {
          setRenamingFile(file);
          setNewFileName(file.name);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [selectedFiles, files]);

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
      message.error(t('files:failedToListLocalFiles', { error: err?.message || 'Unknown error' }));
    } finally {
      setLoading(false);
    }
  };

  const handleNavigate = (filePath: string) => {
    setCurrentPath(filePath);
    setPathInput(filePath);
    loadFiles(filePath);
  };

  const handleFileClick = (e: React.MouseEvent, file: LocalFile) => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const isMultiKey = isMac ? e.metaKey : e.ctrlKey;
    const isRangeKey = e.shiftKey;

    if (isRangeKey && lastClickedFile) {
      const fileNames = filteredFiles.map(f => f.name);
      const startIdx = fileNames.indexOf(lastClickedFile);
      const endIdx = fileNames.indexOf(file.name);
      if (startIdx >= 0 && endIdx >= 0) {
        const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
        const rangeNames = fileNames.slice(from, to + 1);
        setSelectedFiles(new Set(isMultiKey ? [...selectedFiles, ...rangeNames] : rangeNames));
      }
    } else if (isMultiKey) {
      const newSet = new Set(selectedFiles);
      if (newSet.has(file.name)) {
        newSet.delete(file.name);
      } else {
        newSet.add(file.name);
      }
      setSelectedFiles(newSet);
    } else {
      setSelectedFiles(new Set(selectedFiles.has(file.name) && selectedFiles.size === 1 ? [] : [file.name]));
    }
    setLastClickedFile(file.name);
    fileListRef.current?.focus();
  };

  const handleFileDoubleClick = (file: LocalFile) => {
    if (file.isDir) {
      handleNavigate(file.path);
    } else {
      // Open file in standalone browser editor window
      if ((window as any).go?.app?.App?.OpenEditorWindow) {
        (window as any).go.app.App.OpenEditorWindow(file.path, false, sessionId || '')
          .catch((err: any) => message.error(t('files:failedToOpenEditor', { error: err?.message || err })));
      }
    }
  };

  const handleContextMenu = (e: React.MouseEvent, file: LocalFile) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedFiles.has(file.name)) {
      setSelectedFiles(new Set([file.name]));
    }
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
        .catch((err: any) => message.error(t('files:failedToOpenEditor', { error: err?.message || err })));
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
      title: t('files:deleteType', { type: file.isDir ? t('files:directory') : t('files:file') }),
      content: t('files:deleteConfirm', { name: file.name }),
      okText: t('common:delete'),
      okType: 'danger',
      cancelText: t('common:cancel'),
      onOk: async () => {
        try {
          if (file.isDir) {
            if ((window as any).go?.app?.App?.DeleteLocalDirectory) {
              await (window as any).go.app.App.DeleteLocalDirectory(file.path);
              message.success(t('files:deletedDirectory', { name: file.name }));
              loadFiles(currentPath);
            }
          } else {
            if ((window as any).go?.app?.App?.DeleteLocalFile) {
              await (window as any).go.app.App.DeleteLocalFile(file.path);
              message.success(t('files:deletedFile', { name: file.name }));
              loadFiles(currentPath);
            }
          }
        } catch (err: any) {
          message.error(t('files:deleteFailed', { error: err?.message || err }));
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

  const handleCopyToSystemClipboard = async () => {
    setContextMenu(prev => ({ ...prev, visible: false }));
    // Collect all selected files' paths
    const selectedNames = selectedFiles.size > 0 ? [...selectedFiles] : (contextMenu.file ? [contextMenu.file.name] : []);
    const paths = selectedNames
      .map(name => filteredFiles.find(f => f.name === name)?.path)
      .filter((p): p is string => !!p);
    if (paths.length === 0) return;
    try {
      await CopyFilesToSystemClipboard(paths);
      message.success(t('files:copiedToClipboard', { name: `${paths.length} item(s)` }));
    } catch (err: any) {
      message.error(t('files:copyToClipboardFailed', { error: err?.message || err }));
    }
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
        message.success(t('files:renamedTo', { name }));
        loadFiles(currentPath);
      }
    } catch (err: any) {
      message.error(t('files:renameFailed', { error: err?.message || err }));
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
    setDragTarget('local-fm');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  // 'drop' never fires in Wails WKWebView, so we cannot rely on it to clear
  // the drag-over visual state.  Listen to 'dragend' on window instead.
  useEffect(() => {
    const onDragEnd = () => setDragOver(false);
    window.addEventListener('dragend', onDragEnd);
    return () => window.removeEventListener('dragend', onDragEnd);
  }, []);

  const handleDropFiles = async (e: React.DragEvent) => {
    console.log('🟡 [LocalFileManager] handleDropFiles fired, target:', (e.target as HTMLElement)?.className)
    dlog('[LocalFM] handleDropFiles fired')
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    // Read from shared drag state (WKWebView-safe) with dataTransfer fallback
    const payload = getDragPayload();
    clearDragPayload();
    const remoteFilePath = (payload?.source === 'remote' ? payload.path : '') 
      || e.dataTransfer.getData('remoteFile');
    if (remoteFilePath && sessionId) {
      console.log('📥 Download remote file to local:', remoteFilePath, '->', currentPath);
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
    // Store path in shared memory -- WKWebView often clears dataTransfer on drop.
    setDragPayload({ source: 'local', path: file.path })
    e.dataTransfer.setData('text/plain', file.path)
    e.dataTransfer.effectAllowed = 'copy'
    console.log('🟢 [LocalFileManager] dragStart, path:', file.path)
    dlog('[LocalFM] dragStart path=' + file.path)
  };

  const handleFileDragEnd = () => {
    console.log('🔴 [LocalFileManager] dragEnd fired')
    dlog('[LocalFM] dragEnd fired')
    // NOTE: Do NOT clearDragPayload() here. The terminal's window-level
    // dragend handler (capture phase) fires first and needs the payload.
    // It clears the payload itself after processing.
  };

  const filteredFiles = showHidden
    ? files
    : files.filter(f => !f.name.startsWith('.'));

  return (
    <div
      className={`local-file-manager ${dragOver ? 'drag-over' : ''}`}
      data-current-path={currentPath}
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
            title={t('files:clickToEditPath')}
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
            <span style={{ marginLeft: 8 }}>{t('common:loading')}</span>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="file-list-empty">{t('files:emptyDirectory')}</div>
        ) : (
          filteredFiles.map((file, index) => (
            <div
              key={index}
              className={`file-item ${file.isDir ? 'directory' : 'file'} ${
                selectedFiles.has(file.name) ? 'selected' : ''
              }`}
              onClick={e => handleFileClick(e, file)}
              onDoubleClick={() => handleFileDoubleClick(file)}
              onContextMenu={e => handleContextMenu(e, file)}
              draggable={true}
              onDragStart={e => handleFileDragStart(e, file)}
              onDragEnd={handleFileDragEnd}
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
          <div>{t('files:dropFilesToDownload')}</div>
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
              <span>{t('common:edit')}</span>
            </div>
          )}
          <div className="context-menu-item" onClick={handleCopyToSystemClipboard}>
            <CopyOutlined />
            <span>{t('files:copyToClipboard')}{selectedFiles.size > 1 ? ` (${selectedFiles.size})` : ''}</span>
          </div>
          {!contextMenu.file.isDir && onUploadFile && (
            <div className="context-menu-item" onClick={handleContextMenuUpload}>
              <UploadOutlined />
              <span>{t('files:uploadToRemote')}</span>
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
              <span>{t('files:openDirectory')}</span>
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
            <span>{t('common:refresh')}</span>
          </div>
          <div
            className="context-menu-item"
            onClick={handleContextMenuRename}
          >
            <EditOutlined />
            <span>{t('common:rename')}</span>
          </div>
          <div className="context-menu-divider" />
          <div className="context-menu-item danger" onClick={handleContextMenuDelete}>
            <DeleteOutlined />
            <span>{t('common:delete')}</span>
          </div>
        </div>
      )}

    </div>
  );
};

export default LocalFileManager;
