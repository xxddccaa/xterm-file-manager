import { describe, expect, it } from 'vitest'

import { filterCommandSnippets, reorderCommandSnippetsByVisibleIds } from './commandSnippets'

const snippets = [
  {
    id: 'tmux-attach',
    title: 'Attach tmux session',
    command: 'tmux a -t mysession',
    description: 'Attach to an existing tmux session.',
    tags: ['tmux', 'attach'],
  },
  {
    id: 'tmux-kill-server',
    title: 'Kill tmux server',
    command: 'tmux kill-server',
    description: 'Stop the whole tmux server.',
    tags: ['tmux', 'kill'],
  },
  {
    id: 'docker-logs',
    title: 'Docker logs',
    command: 'docker logs -f --tail=200 my-container',
    description: 'Follow container logs.',
    tags: ['docker', 'logs'],
  },
]

describe('filterCommandSnippets', () => {
  it('returns the original list when search is empty', () => {
    expect(filterCommandSnippets(snippets, '')).toEqual(snippets)
  })

  it('finds commands by normal substring match', () => {
    expect(filterCommandSnippets(snippets, 'tmux').map((snippet) => snippet.id)).toEqual([
      'tmux-kill-server',
      'tmux-attach',
    ])
  })

  it('matches multiple tokens across title and command', () => {
    expect(filterCommandSnippets(snippets, 'attach mysession').map((snippet) => snippet.id)).toEqual([
      'tmux-attach',
    ])
  })

  it('supports fuzzy matching for easy-to-forget command names', () => {
    expect(filterCommandSnippets(snippets, 'kilsrv').map((snippet) => snippet.id)).toEqual([
      'tmux-kill-server',
    ])
  })

  it('reorders snippets by dragging within the visible list order', () => {
    expect(
      reorderCommandSnippetsByVisibleIds(
        snippets,
        'docker-logs',
        'tmux-attach',
        snippets.map((snippet) => snippet.id),
      ).map((snippet) => snippet.id),
    ).toEqual([
      'docker-logs',
      'tmux-attach',
      'tmux-kill-server',
    ])
  })
})
