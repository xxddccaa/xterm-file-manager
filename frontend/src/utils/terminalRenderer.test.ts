import { describe, expect, it } from 'vitest'

import { getTerminalRendererMode, isWindowsPlatform } from './terminalRenderer'

describe('terminalRenderer', () => {
  it('detects Windows from platform', () => {
    expect(isWindowsPlatform('Win32', '')).toBe(true)
    expect(isWindowsPlatform('MacIntel', '')).toBe(false)
  })

  it('detects Windows from user agent fallback', () => {
    expect(isWindowsPlatform('', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(true)
  })

  it('uses the DOM renderer for Windows local terminals', () => {
    expect(getTerminalRendererMode({
      sessionType: 'local',
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })).toBe('dom')
  })

  it('keeps accelerated rendering for Windows SSH terminals', () => {
    expect(getTerminalRendererMode({
      sessionType: 'ssh',
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
    })).toBe('accelerated')
  })

  it('keeps accelerated rendering for non-Windows local terminals', () => {
    expect(getTerminalRendererMode({
      sessionType: 'local',
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    })).toBe('accelerated')
  })
})
