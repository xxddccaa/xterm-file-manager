import { describe, expect, it } from 'vitest'

import { escapeShellPath, escapeShellPaths } from './shellEscape'

describe('shellEscape', () => {
  it('quotes Windows paths with spaces using double quotes', () => {
    expect(escapeShellPath('C:\\Program Files\\xterm file manager\\test.txt'))
      .toBe('"C:\\Program Files\\xterm file manager\\test.txt"')
  })

  it('keeps simple Windows paths unchanged', () => {
    expect(escapeShellPath('C:\\Temp\\test.txt')).toBe('C:\\Temp\\test.txt')
  })

  it('quotes POSIX paths with spaces using single quotes', () => {
    expect(escapeShellPath('/tmp/with space/test.txt')).toBe("'/tmp/with space/test.txt'")
  })

  it('joins multiple escaped paths with spaces', () => {
    expect(escapeShellPaths([
      'C:\\Program Files\\test.txt',
      '/tmp/with space/test.txt',
    ])).toBe("\"C:\\Program Files\\test.txt\" '/tmp/with space/test.txt'")
  })
})
