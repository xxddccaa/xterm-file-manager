import { describe, expect, it } from 'vitest'

import {
  isDeferredTextBeforeInput,
  shouldDeferMacPunctuationToBeforeInput,
} from './terminalIme'

describe('shouldDeferMacPunctuationToBeforeInput', () => {
  it('defers plain macOS punctuation keys to beforeinput', () => {
    expect(shouldDeferMacPunctuationToBeforeInput(true, {
      key: ',',
      code: 'Comma',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    })).toBe(true)
  })

  it('keeps shifted punctuation eligible so full-width variants can commit through IME', () => {
    expect(shouldDeferMacPunctuationToBeforeInput(true, {
      key: '?',
      code: 'Slash',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    })).toBe(true)
  })

  it('does not defer letters or modified shortcuts', () => {
    expect(shouldDeferMacPunctuationToBeforeInput(true, {
      key: 'a',
      code: 'KeyA',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    })).toBe(false)

    expect(shouldDeferMacPunctuationToBeforeInput(true, {
      key: ',',
      code: 'Comma',
      ctrlKey: false,
      metaKey: true,
      altKey: false,
    })).toBe(false)

    expect(shouldDeferMacPunctuationToBeforeInput(false, {
      key: ',',
      code: 'Comma',
      ctrlKey: false,
      metaKey: false,
      altKey: false,
    })).toBe(false)
  })
})

describe('isDeferredTextBeforeInput', () => {
  it('accepts committed insert text events', () => {
    expect(isDeferredTextBeforeInput('insertText', '，')).toBe(true)
    expect(isDeferredTextBeforeInput('insertCompositionText', '。')).toBe(true)
  })

  it('ignores empty or non-insert beforeinput events', () => {
    expect(isDeferredTextBeforeInput('deleteContentBackward', null)).toBe(false)
    expect(isDeferredTextBeforeInput('insertParagraph', '')).toBe(false)
  })
})
