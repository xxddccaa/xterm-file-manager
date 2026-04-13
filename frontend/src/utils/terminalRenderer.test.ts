import { describe, expect, it } from 'vitest'

import { getTerminalRendererMode, isApplePlatform, isWindowsPlatform } from './terminalRenderer'

describe('terminalRenderer', () => {
  it('detects Windows from platform', () => {
    expect(isWindowsPlatform('Win32', '')).toBe(true)
    expect(isWindowsPlatform('MacIntel', '')).toBe(false)
  })

  it('detects Apple platforms from platform and user agent', () => {
    expect(isApplePlatform('MacIntel', '')).toBe(true)
    expect(isApplePlatform('', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_0)')).toBe(true)
    expect(isApplePlatform('Win32', '')).toBe(false)
  })

  it('detects Windows from user agent fallback', () => {
    expect(isWindowsPlatform('', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe(true)
  })

  it('uses the DOM renderer for Apple terminals to avoid glyph corruption in WKWebView', () => {
    expect(getTerminalRendererMode({
      sessionType: 'local',
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_0)',
    })).toBe('dom')
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

  it('keeps accelerated rendering for non-Apple, non-Windows local terminals', () => {
    expect(getTerminalRendererMode({
      sessionType: 'local',
      platform: 'Linux x86_64',
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64)',
    })).toBe('accelerated')
  })
})
