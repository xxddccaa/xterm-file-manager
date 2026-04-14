import { describe, expect, it } from 'vitest'

import { TERMINAL_COPY_CACHE_MS, resolveTerminalCopyText } from './terminalCopy'

describe('resolveTerminalCopyText', () => {
  it('returns the live terminal selection when available', () => {
    expect(resolveTerminalCopyText({
      isActive: true,
      currentSelection: 'line 1\nline 2',
      hasTerminalSelection: true,
      cachedSelection: '',
      cachedSelectionAgeMs: 0,
    })).toBe('line 1\nline 2')
  })

  it('falls back to the cached selection while xterm still reports a selection', () => {
    expect(resolveTerminalCopyText({
      isActive: true,
      currentSelection: '',
      hasTerminalSelection: true,
      cachedSelection: 'cached block',
      cachedSelectionAgeMs: TERMINAL_COPY_CACHE_MS + 5000,
    })).toBe('cached block')
  })

  it('uses a recent cached selection for toolbar or menu copy actions', () => {
    expect(resolveTerminalCopyText({
      isActive: true,
      currentSelection: '',
      hasTerminalSelection: false,
      cachedSelection: 'recent block',
      cachedSelectionAgeMs: TERMINAL_COPY_CACHE_MS - 1,
    })).toBe('recent block')
  })

  it('does not reuse a stale cached selection', () => {
    expect(resolveTerminalCopyText({
      isActive: true,
      currentSelection: '',
      hasTerminalSelection: false,
      cachedSelection: 'stale block',
      cachedSelectionAgeMs: TERMINAL_COPY_CACHE_MS + 1,
    })).toBeNull()
  })

  it('does not override a normal DOM selection outside the terminal', () => {
    expect(resolveTerminalCopyText({
      isActive: true,
      currentSelection: '',
      hasTerminalSelection: false,
      cachedSelection: 'terminal text',
      cachedSelectionAgeMs: 100,
      hasExternalDomSelection: true,
    })).toBeNull()
  })

  it('does not steal copy actions from editable controls', () => {
    expect(resolveTerminalCopyText({
      isActive: true,
      currentSelection: '',
      hasTerminalSelection: false,
      cachedSelection: 'terminal text',
      cachedSelectionAgeMs: 100,
      isEditableTarget: true,
    })).toBeNull()
  })
})
