const TERMINAL_HISTORY_MAX_CHARS = 1024 * 1024

const terminalHistoryByKey = new Map<string, string>()

export const appendTerminalHistory = (historyKey: string, chunk: string): void => {
  if (!historyKey || !chunk) {
    return
  }

  const previous = terminalHistoryByKey.get(historyKey) || ''
  let next = previous + chunk

  if (next.length > TERMINAL_HISTORY_MAX_CHARS) {
    next = next.slice(next.length - TERMINAL_HISTORY_MAX_CHARS)
  }

  terminalHistoryByKey.set(historyKey, next)
}

export const getTerminalHistory = (historyKey: string): string => {
  if (!historyKey) {
    return ''
  }

  return terminalHistoryByKey.get(historyKey) || ''
}

export const clearTerminalHistory = (historyKey: string): void => {
  if (!historyKey) {
    return
  }

  terminalHistoryByKey.delete(historyKey)
}
