export interface TerminalImeKeyEvent {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
}

const MAC_IME_PUNCTUATION_CODES = new Set([
  'Backquote',
  'Minus',
  'Equal',
  'BracketLeft',
  'BracketRight',
  'Backslash',
  'Semicolon',
  'Quote',
  'Comma',
  'Period',
  'Slash',
])

export const shouldDeferMacPunctuationToBeforeInput = (
  isMac: boolean,
  event: TerminalImeKeyEvent,
): boolean => {
  if (!isMac || event.ctrlKey || event.metaKey || event.altKey) {
    return false
  }

  if (event.key.length !== 1) {
    return false
  }

  return MAC_IME_PUNCTUATION_CODES.has(event.code)
}

export const isDeferredTextBeforeInput = (
  inputType?: string | null,
  data?: string | null,
): boolean => {
  if (!data) {
    return false
  }

  return inputType === 'insertText' || inputType === 'insertCompositionText'
}
