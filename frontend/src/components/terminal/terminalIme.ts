export interface TerminalImeKeyEvent {
  key: string
  code: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  isComposing?: boolean
  keyCode?: number
}

export const shouldTrackMacNativeTextInputCandidate = (
  isMac: boolean,
  event: TerminalImeKeyEvent,
): boolean => {
  if (!isMac || event.ctrlKey || event.metaKey || event.altKey) {
    return false
  }

  if (event.isComposing || event.keyCode === 229) {
    return false
  }

  if (event.key.length !== 1) {
    return false
  }

  return true
}

export const getMacNativeTextInputStage = (
  inputType?: string | null,
  data?: string | null,
): 'composition' | 'commit' | null => {
  if (!data) {
    return null
  }

  if (inputType === 'insertCompositionText') {
    return 'composition'
  }

  if (inputType === 'insertText') {
    return 'commit'
  }

  return null
}
