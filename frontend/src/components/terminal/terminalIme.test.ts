import { describe, expect, it } from 'vitest'

import {
  getMacNativeTextInputStage,
  shouldTrackMacNativeTextInputCandidate,
} from './terminalIme'

describe('shouldTrackMacNativeTextInputCandidate', () => {
  it('tracks plain macOS single-character keys, including punctuation and letters', () => {
    expect(shouldTrackMacNativeTextInputCandidate(true, {
      key: ',',
      code: 'Comma',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      isComposing: false,
      keyCode: 188,
    })).toBe(true)

    expect(shouldTrackMacNativeTextInputCandidate(true, {
      key: 'z',
      code: 'KeyZ',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      isComposing: false,
      keyCode: 90,
    })).toBe(true)
  })

  it('ignores modified shortcuts, non-mac platforms, and active composition events', () => {
    expect(shouldTrackMacNativeTextInputCandidate(true, {
      key: ',',
      code: 'Comma',
      ctrlKey: false,
      metaKey: true,
      altKey: false,
      isComposing: false,
      keyCode: 188,
    })).toBe(false)

    expect(shouldTrackMacNativeTextInputCandidate(false, {
      key: 'z',
      code: 'KeyZ',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      isComposing: false,
      keyCode: 90,
    })).toBe(false)

    expect(shouldTrackMacNativeTextInputCandidate(true, {
      key: 'z',
      code: 'KeyZ',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      isComposing: true,
      keyCode: 229,
    })).toBe(false)
  })
})

describe('getMacNativeTextInputStage', () => {
  it('distinguishes between composition updates and committed text', () => {
    expect(getMacNativeTextInputStage('insertText', '，')).toBe('commit')
    expect(getMacNativeTextInputStage('insertCompositionText', 'z')).toBe('composition')
  })

  it('ignores empty or non-insert beforeinput events', () => {
    expect(getMacNativeTextInputStage('deleteContentBackward', null)).toBeNull()
    expect(getMacNativeTextInputStage('insertParagraph', '')).toBeNull()
  })
})
