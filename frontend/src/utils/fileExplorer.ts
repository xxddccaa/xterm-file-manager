export interface ExplorerEntryLike {
  name: string;
  isDir: boolean;
}

export function sortExplorerEntries<T extends ExplorerEntryLike>(entries: T[]): T[] {
  return [...entries].sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });
}

export function filterExplorerEntries<T extends ExplorerEntryLike>(entries: T[], showHidden: boolean): T[] {
  if (showHidden) {
    return entries;
  }

  return entries.filter((entry) => !entry.name.startsWith('.'));
}
