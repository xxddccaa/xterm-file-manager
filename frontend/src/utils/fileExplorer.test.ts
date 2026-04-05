import { describe, expect, it } from 'vitest';

import { filterExplorerEntries, sortExplorerEntries } from './fileExplorer';

describe('fileExplorer', () => {
  it('sorts directories before files and keeps alphabetical order', () => {
    const sorted = sortExplorerEntries([
      { name: 'z-file.ts', isDir: false },
      { name: 'alpha', isDir: true },
      { name: 'beta', isDir: true },
      { name: 'a-file.ts', isDir: false },
    ]);

    expect(sorted.map((entry) => entry.name)).toEqual([
      'alpha',
      'beta',
      'a-file.ts',
      'z-file.ts',
    ]);
  });

  it('filters hidden entries only when requested', () => {
    const entries = [
      { name: '.git', isDir: true },
      { name: 'src', isDir: true },
      { name: '.env', isDir: false },
      { name: 'package.json', isDir: false },
    ];

    expect(filterExplorerEntries(entries, true)).toHaveLength(4);
    expect(filterExplorerEntries(entries, false).map((entry) => entry.name)).toEqual([
      'src',
      'package.json',
    ]);
  });
});
