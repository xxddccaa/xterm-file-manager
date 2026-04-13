export type TerminalRendererMode = 'accelerated' | 'dom'

interface RendererStrategyOptions {
  sessionType: 'ssh' | 'local'
  platform?: string
  userAgent?: string
}

export function isWindowsPlatform(platform = '', userAgent = ''): boolean {
  const normalizedPlatform = platform.toLowerCase()
  const normalizedUserAgent = userAgent.toLowerCase()

  return normalizedPlatform.includes('win') || normalizedUserAgent.includes('windows')
}

export function isApplePlatform(platform = '', userAgent = ''): boolean {
  const normalizedPlatform = platform.toLowerCase()
  const normalizedUserAgent = userAgent.toLowerCase()

  return normalizedPlatform.includes('mac') ||
    normalizedPlatform.includes('iphone') ||
    normalizedPlatform.includes('ipad') ||
    normalizedUserAgent.includes('mac os x') ||
    normalizedUserAgent.includes('iphone') ||
    normalizedUserAgent.includes('ipad')
}

export function getTerminalRendererMode({
  sessionType,
  platform,
  userAgent,
}: RendererStrategyOptions): TerminalRendererMode {
  // Wails uses WKWebView on macOS. The WebGL renderer can occasionally corrupt
  // glyphs there, so prefer the safer built-in renderer for visual correctness.
  if (isApplePlatform(platform, userAgent)) {
    return 'dom'
  }

  // WebView2 on Windows can repaint sibling panes while the terminal renderer
  // updates, which makes the local file manager flash next to a live terminal.
  if (sessionType === 'local' && isWindowsPlatform(platform, userAgent)) {
    return 'dom'
  }

  return 'accelerated'
}
