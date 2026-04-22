import { beforeEach, describe, expect, it } from 'vitest'

import { appendTerminalHistory, clearTerminalHistory, getTerminalHistory } from './terminalHistory'

describe('terminalHistory', () => {
  const historyKey = 'tab-history-test'

  beforeEach(() => {
    clearTerminalHistory(historyKey)
  })

  it('appends chunks for the same tab', () => {
    appendTerminalHistory(historyKey, 'echo hello')
    appendTerminalHistory(historyKey, '\r\nhello\r\n')

    expect(getTerminalHistory(historyKey)).toBe('echo hello\r\nhello\r\n')
  })

  it('clears tab history when requested', () => {
    appendTerminalHistory(historyKey, 'pwd')

    clearTerminalHistory(historyKey)

    expect(getTerminalHistory(historyKey)).toBe('')
  })

  it('keeps histories isolated per tab', () => {
    const otherHistoryKey = 'tab-history-other'
    clearTerminalHistory(otherHistoryKey)

    appendTerminalHistory(historyKey, 'first')
    appendTerminalHistory(otherHistoryKey, 'second')

    expect(getTerminalHistory(historyKey)).toBe('first')
    expect(getTerminalHistory(otherHistoryKey)).toBe('second')
  })
})
