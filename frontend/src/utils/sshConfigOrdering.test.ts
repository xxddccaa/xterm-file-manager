import { describe, expect, it } from 'vitest'

import {
  haveSameSSHConfigOrder,
  parseSSHConfigBlocks,
  reorderSSHConfigContent,
  reorderSSHConfigsByVisibleHosts,
  sortSSHConfigsByName,
} from './sshConfigOrdering'

describe('parseSSHConfigBlocks', () => {
  it('keeps global config before the first host as prefix', () => {
    const parsed = parseSSHConfigBlocks([
      '# shared defaults',
      'ServerAliveInterval 30',
      '',
      'Host app',
      '  HostName 1.2.3.4',
      '',
    ].join('\n'))

    expect(parsed.prefix).toContain('ServerAliveInterval 30')
    expect(parsed.blocks).toHaveLength(1)
    expect(parsed.blocks[0].aliases).toEqual(['app'])
  })
})

describe('reorderSSHConfigContent', () => {
  it('reorders host blocks while keeping the header in place', () => {
    const original = [
      '# global config',
      'ServerAliveInterval 30',
      '',
      'Host beta',
      '  HostName beta.example.com',
      '',
      'Host alpha',
      '  HostName alpha.example.com',
      '',
    ].join('\n')

    const reordered = reorderSSHConfigContent(original, ['alpha', 'beta'])

    expect(reordered.changed).toBe(true)
    expect(reordered.matchedBlockCount).toBe(2)
    expect(reordered.content).toContain('# global config\nServerAliveInterval 30\n\nHost alpha')
    expect(reordered.content.indexOf('Host alpha')).toBeLessThan(reordered.content.indexOf('Host beta'))
  })

  it('moves multi-alias blocks together', () => {
    const original = [
      'Host z-last z-last-alt',
      '  HostName z-last.example.com',
      '',
      'Host alpha',
      '  HostName alpha.example.com',
      '',
    ].join('\n')

    const reordered = reorderSSHConfigContent(original, ['alpha', 'z-last-alt', 'z-last'])

    expect(reordered.changed).toBe(true)
    expect(reordered.content.indexOf('Host alpha')).toBeLessThan(reordered.content.indexOf('Host z-last z-last-alt'))
  })

  it('leaves unmatched blocks in their original relative order', () => {
    const original = [
      'Host kept',
      '  HostName kept.example.com',
      '',
      'Host move-me',
      '  HostName move-me.example.com',
      '',
      'Host unknown',
      '  HostName unknown.example.com',
      '',
    ].join('\n')

    const reordered = reorderSSHConfigContent(original, ['move-me', 'kept'])

    expect(reordered.content.indexOf('Host move-me')).toBeLessThan(reordered.content.indexOf('Host kept'))
    expect(reordered.content.indexOf('Host unknown')).toBeGreaterThan(reordered.content.indexOf('Host kept'))
  })
})

describe('reorderSSHConfigsByVisibleHosts', () => {
  it('reorders only the visible hosts when search filtering is active', () => {
    const configs = [
      { host: 'alpha' },
      { host: 'beta' },
      { host: 'gamma' },
      { host: 'delta' },
    ]

    const reordered = reorderSSHConfigsByVisibleHosts(configs, 'delta', 'beta', ['beta', 'delta'])

    expect(reordered.map((config) => config.host)).toEqual(['alpha', 'delta', 'gamma', 'beta'])
  })
})

describe('sortSSHConfigsByName', () => {
  it('sorts hosts ascending and descending', () => {
    const configs = [{ host: 'srv-10' }, { host: 'srv-2' }, { host: 'alpha' }]

    expect(sortSSHConfigsByName(configs, 'asc').map((config) => config.host)).toEqual([
      'alpha',
      'srv-2',
      'srv-10',
    ])
    expect(sortSSHConfigsByName(configs, 'desc').map((config) => config.host)).toEqual([
      'srv-10',
      'srv-2',
      'alpha',
    ])
  })
})

describe('haveSameSSHConfigOrder', () => {
  it('compares host order only', () => {
    expect(haveSameSSHConfigOrder([{ host: 'a' }, { host: 'b' }], [{ host: 'a' }, { host: 'b' }])).toBe(true)
    expect(haveSameSSHConfigOrder([{ host: 'a' }, { host: 'b' }], [{ host: 'b' }, { host: 'a' }])).toBe(false)
  })
})
