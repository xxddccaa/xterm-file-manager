import React, { useState, useEffect, useRef } from 'react';
import {
  FolderOutlined,
  FolderOpenOutlined,
  FileOutlined,
  DownloadOutlined,
  ReloadOutlined,
  UploadOutlined,
  ArrowLeftOutlined,
  DeleteOutlined,
  EditOutlined,
  CopyOutlined,
  CaretRightOutlined,
  CaretDownOutlined,
  ApartmentOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { Input, Button, message, Spin, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  GetHomeDirectory,
  ListLocalFiles,
  OpenEditorWindow,
  DeleteLocalDirectory,
  DeleteLocalFile,
  DownloadFile,
  RenameLocalFile,
  CopyFilesToSystemClipboard,
} from '../../../wailsjs/go/app/App';
import logger from '../../utils/logger';
import { setDragPayload, getDragPayload, clearDragPayload } from '../../utils/dragState';
import { setDragTarget } from '../../utils/dragState';
import { dlog } from '../../utils/debugLog';
import { filterExplorerEntries, sortExplorerEntries } from '../../utils/fileExplorer';
import { getParentLocalPath, isLocalPathRoot } from '../../utils/localPath';
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

type ViewMode = 'list' | 'tree';

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
  const [viewMode, setViewMode] = useState<ViewMode>('tree');
  const [expandedPaths, setExpandedPaths] = useState<Record<string, boolean>>({});
  const [treeChildren, setTreeChildren] = useState<Record<string, LocalFile[]>>({});
  const [treeLoadingPaths, setTreeLoadingPaths] = useState<Record<string, boolean>>({});
  const [treeSelectedPath, setTreeSelectedPath] = useState<string | null>(null);
  const [treeSelectedFile, setTreeSelectedFile] = useState<LocalFile | null>(null);

  useEffect(() => {
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

  useEffect(() => {
    if (refreshKey && refreshKey > 0 && currentPath) {
      loadFiles(currentPath);
    }
  }, [refreshKey]);

  useEffect(() => {
    const handleClick = () => setContextMenu(prev => ({ ...prev, visible: false }));
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    setExpandedPaths({});
    setTreeChildren({});
    setTreeLoadingPaths({});
    setTreeSelectedPath(null);
    setTreeSelectedFile(null);
  }, [currentPath]);

  useEffect(() => {
    if (!currentPath) return;
    setTreeChildren(prev => ({
      ...prev,
      [currentPath]: sortExplorerEntries(files),
    }));
  }, [currentPath, files]);

  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const normalizeKey = (value: string) => (value.length === 1 ? value.toLowerCase() : value);
    const isKey = (event: KeyboardEvent, key: string, code: string) =>
      normalizeKey(event.key) === key || event.code === code;
    const isEditableTarget = (target: EventTarget | null) => {
      if (!target || !(target instanceof HTMLElement)) return false;
      const tagName = target.tagName;
      return tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable;
    };

    logger.log('🎯 [LocalFileManager] Installing keyboard listener, selectedFiles:', [...selectedFiles]);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;

      const isRenameShortcut =
        (e.key === 'F2' || e.code === 'F2') ||
        (isMac && e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && isKey(e, 'r', 'KeyR')) ||
        (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey);

      const selectedListFile =
        selectedFiles.size === 1 ? files.find((file) => file.name === [...selectedFiles][0]) ?? null : null;
      const activeFile = viewMode === 'tree' ? treeSelectedFile : selectedListFile;

      if (isRenameShortcut && activeFile) {
        logger.log('✅ [LocalFileManager] Rename shortcut pressed with selected file:', activeFile.path);
        e.preventDefault();
        e.stopPropagation();
        setRenamingFile(activeFile);
        setNewFileName(activeFile.name);
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [selectedFiles, files, treeSelectedFile, viewMode]);

  const resetTreeExplorerState = () => {
    setExpandedPaths({});
    setTreeChildren({});
    setTreeLoadingPaths({});
    setTreeSelectedPath(null);
    setTreeSelectedFile(null);
  };

  const loadFiles = async (path: string) => {
    try {
      setLoading(true);
      if ((window as any).go?.app?.App?.ListLocalFiles) {
        const fileList = await (window as any).go.app.App.ListLocalFiles(path);
        setFiles(sortExplorerEntries(fileList || []));
      }
    } catch (err: any) {
      console.error('Failed to list local files:', err);
      message.error(t('files:failedToListLocalFiles', { error: err?.message || 'Unknown error' }));
    } finally {
      setLoading(false);
    }
  };

  const loadTreeChildren = async (path: string) => {
    if (treeChildren[path] || treeLoadingPaths[path] || !(window as any).go?.app?.App?.ListLocalFiles) {
      return;
    }

    setTreeLoadingPaths(prev => ({ ...prev, [path]: true }));
    try {
      const fileList = await (window as any).go.app.App.ListLocalFiles(path);
      setTreeChildren(prev => ({
        ...prev,
        [path]: sortExplorerEntries(fileList || []),
      }));
    } catch (err: any) {
      message.error(t('files:failedToListLocalFiles', { error: err?.message || 'Unknown error' }));
    } finally {
      setTreeLoadingPaths(prev => {
        const next = { ...prev };
        delete next[path];
        return next;
      });
    }
  };

  const handleNavigate = (filePath: string) => {
    setCurrentPath(filePath);
    setPathInput(filePath);
    setSelectedFiles(new Set());
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

  const openLocalFile = (file: LocalFile) => {
    if ((window as any).go?.app?.App?.OpenEditorWindow) {
      (window as any).go.app.App.OpenEditorWindow(file.path, false, sessionId || '')
        .catch((err: any) => message.error(t('files:failedToOpenEditor', { error: err?.message || err })));
    }
  };

  const handleFileDoubleClick = (file: LocalFile) => {
    if (file.isDir) {
      handleNavigate(file.path);
    } else {
      openLocalFile(file);
    }
  };

  const toggleTreeFolder = async (file: LocalFile) => {
    if (!file.isDir) return;

    const willExpand = !expandedPaths[file.path];
    setExpandedPaths(prev => ({
      ...prev,
      [file.path]: willExpand,
    }));

    if (willExpand) {
      await loadTreeChildren(file.path);
    }
  };

  const handleTreeItemClick = async (e: React.MouseEvent, file: LocalFile) => {
    e.stopPropagation();
    setTreeSelectedPath(file.path);
    setTreeSelectedFile(file);
    setSelectedFiles(new Set());

    if (file.isDir) {
      await toggleTreeFolder(file);
    }
  };

  const handleTreeItemDoubleClick = async (file: LocalFile) => {
    setTreeSelectedPath(file.path);
    setTreeSelectedFile(file);

    if (file.isDir) {
      await toggleTreeFolder(file);
    } else {
      openLocalFile(file);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, file: LocalFile) => {
    e.preventDefault();
    e.stopPropagation();

    if (viewMode === 'tree') {
      setTreeSelectedPath(file.path);
      setTreeSelectedFile(file);
    } else if (!selectedFiles.has(file.name)) {
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
    openLocalFile(contextMenu.file);
  };

  const handleContextMenuUpload = () => {
    if (!contextMenu.file || !onUploadFile) return;
    setContextMenu(prev => ({ ...prev, visible: false }));
    onUploadFile(contextMenu.file.path, '~');
  };

  const handleContextMenuDelete = async () => {
    if (!contextMenu.file) return;
    const file = contextMenu.file;
    setContextMenu(prev => ({ ...prev, visible: false }));

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
            }
          } else if ((window as any).go?.app?.App?.DeleteLocalFile) {
            await (window as any).go.app.App.DeleteLocalFile(file.path);
            message.success(t('files:deletedFile', { name: file.name }));
          }

          resetTreeExplorerState();
          loadFiles(currentPath);
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

    const paths = viewMode === 'tree'
      ? (contextMenu.file ? [contextMenu.file.path] : treeSelectedFile ? [treeSelectedFile.path] : [])
      : (
        selectedFiles.size > 0
          ? [...selectedFiles]
              .map(name => filteredFiles.find(f => f.name === name)?.path)
              .filter((path): path is string => !!path)
          : contextMenu.file
            ? [contextMenu.file.path]
            : []
      );

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
        resetTreeExplorerState();
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

  const handleRefresh = () => {
    resetTreeExplorerState();
    loadFiles(currentPath);
  };

  const goUp = () => {
    if (!currentPath) return;
    const parentPath = getParentLocalPath(currentPath);
    if (parentPath && parentPath !== currentPath) {
      handleNavigate(parentPath);
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

  useEffect(() => {
    const onDragEnd = () => setDragOver(false);
    window.addEventListener('dragend', onDragEnd);
    return () => window.removeEventListener('dragend', onDragEnd);
  }, []);

  const handleDropFiles = async (e: React.DragEvent) => {
    console.log('🟡 [LocalFileManager] handleDropFiles fired, target:', (e.target as HTMLElement)?.className);
    dlog('[LocalFM] handleDropFiles fired');
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

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
          resetTreeExplorerState();
          loadFiles(currentPath);
          onDownloadComplete?.();
        }
      } catch (err: any) {
        message.error({ content: `Download failed: ${err?.message || err}`, key: 'download' });
      }
    }
  };

  const handleFileDragStart = (e: React.DragEvent, file: LocalFile) => {
    setDragPayload({ source: 'local', path: file.path });
    e.dataTransfer.setData('text/plain', file.path);
    e.dataTransfer.effectAllowed = 'copy';
    console.log('🟢 [LocalFileManager] dragStart, path:', file.path);
    dlog('[LocalFM] dragStart path=' + file.path);
  };

  const handleFileDragEnd = () => {
    console.log('🔴 [LocalFileManager] dragEnd fired');
    dlog('[LocalFM] dragEnd fired');
  };

  const filteredFiles = filterExplorerEntries(files, showHidden);

  const renderTreeNodes = (entries: LocalFile[], depth = 0): React.ReactNode => {
    const visibleEntries = filterExplorerEntries(entries, showHidden);

    return visibleEntries.map((file) => {
      const isExpanded = !!expandedPaths[file.path];
      const children = treeChildren[file.path] || [];
      const isLoadingChildren = !!treeLoadingPaths[file.path];
      const isSelected = treeSelectedPath === file.path;

      return (
        <React.Fragment key={file.path}>
          <div
            className={`tree-file-item ${file.isDir ? 'directory' : 'file'} ${isSelected ? 'selected' : ''}`}
            style={{ paddingLeft: 8 + depth * 16 }}
            onClick={(e) => { void handleTreeItemClick(e, file); }}
            onDoubleClick={() => { void handleTreeItemDoubleClick(file); }}
            onContextMenu={e => handleContextMenu(e, file)}
            draggable={true}
            onDragStart={e => handleFileDragStart(e, file)}
            onDragEnd={handleFileDragEnd}
          >
            <button
              type="button"
              className={`tree-expander ${file.isDir ? 'is-folder' : 'is-file'}`}
              onClick={(e) => {
                e.stopPropagation();
                setTreeSelectedPath(file.path);
                setTreeSelectedFile(file);
                if (file.isDir) {
                  void toggleTreeFolder(file);
                }
              }}
              tabIndex={-1}
            >
              {file.isDir ? (
                isExpanded ? <CaretDownOutlined /> : <CaretRightOutlined />
              ) : (
                <span className="tree-expander-spacer" />
              )}
            </button>
            <span className="file-icon-wrapper">
              {file.isDir ? (
                isExpanded ? <FolderOpenOutlined className="icon-folder" /> : <FolderOutlined className="icon-folder" />
              ) : (
                <FileOutlined className="icon-file" />
              )}
            </span>
            {renamingFile?.path === file.path ? (
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
          </div>
          {file.isDir && isExpanded && (
            <div className="tree-children">
              {isLoadingChildren ? (
                <div className="tree-loading" style={{ paddingLeft: 24 + depth * 16 }}>
                  <Spin size="small" />
                  <span style={{ marginLeft: 8 }}>{t('common:loading')}</span>
                </div>
              ) : filterExplorerEntries(children, showHidden).length > 0 ? (
                renderTreeNodes(children, depth + 1)
              ) : (
                <div className="tree-empty" style={{ paddingLeft: 24 + depth * 16 }}>
                  Empty
                </div>
              )}
            </div>
          )}
        </React.Fragment>
      );
    });
  };

  return (
    <div
      className={`local-file-manager ${dragOver ? 'drag-over' : ''}`}
      data-current-path={currentPath}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDropFiles}
    >
      <div className="path-bar">
        <Button
          icon={<ArrowLeftOutlined />}
          onClick={goUp}
          size="small"
          type="text"
          disabled={!currentPath || isLocalPathRoot(currentPath)}
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
        <Button
          icon={<UnorderedListOutlined />}
          onClick={() => setViewMode('list')}
          size="small"
          type={viewMode === 'list' ? 'default' : 'text'}
          title="List view"
        />
        <Button
          icon={<ApartmentOutlined />}
          onClick={() => setViewMode('tree')}
          size="small"
          type={viewMode === 'tree' ? 'default' : 'text'}
          title="Explorer view"
        />
      </div>

      <div className="file-list" ref={fileListRef} tabIndex={-1} style={{ outline: 'none' }}>
        {loading ? (
          <div className="file-list-empty">
            <Spin size="small" />
            <span style={{ marginLeft: 8 }}>{t('common:loading')}</span>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="file-list-empty">{t('files:emptyDirectory')}</div>
        ) : viewMode === 'tree' ? (
          <div className="file-tree-view">
            <div className="tree-root-label">{currentPath}</div>
            {renderTreeNodes(treeChildren[currentPath] || filteredFiles)}
          </div>
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
              {renamingFile?.path === file.path ? (
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

      {dragOver && (
        <div className="drop-overlay">
          <DownloadOutlined style={{ fontSize: 36, marginBottom: 12 }} />
          <div>{t('files:dropFilesToDownload')}</div>
        </div>
      )}

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
            <span>{t('files:copyToClipboard')}{viewMode === 'list' && selectedFiles.size > 1 ? ` (${selectedFiles.size})` : ''}</span>
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
