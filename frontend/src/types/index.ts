export interface SSHConfigEntry {
  id: string;
  host: string;
  hostname?: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

export interface FileEntry {
  filename: string;
  longname: string;
  attrs: {
    size: number;
    uid: number;
    gid: number;
    mode: number;
    atime: number;
    mtime: number;
  };
  isDirectory: boolean;
}
