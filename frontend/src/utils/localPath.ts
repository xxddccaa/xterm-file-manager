function normalizeWindowsPath(path: string): string {
  return path.replace(/\//g, '\\')
}

function splitWindowsUncPath(path: string): string[] {
  return normalizeWindowsPath(path).split('\\').filter(Boolean)
}

export function isLocalPathRoot(path: string): boolean {
  if (!path) return true

  const windowsPath = normalizeWindowsPath(path)

  if (/^[A-Za-z]:\\?$/.test(windowsPath)) {
    return true
  }

  if (windowsPath.startsWith('\\\\')) {
    return splitWindowsUncPath(windowsPath).length <= 2
  }

  return path === '/'
}

export function getParentLocalPath(path: string): string {
  if (!path || isLocalPathRoot(path)) {
    return path
  }

  const windowsPath = normalizeWindowsPath(path)

  if (/^[A-Za-z]:\\/.test(windowsPath)) {
    const drive = windowsPath.slice(0, 2)
    const rest = windowsPath.slice(2).replace(/^\\+|\\+$/g, '')
    const parts = rest ? rest.split('\\').filter(Boolean) : []

    if (parts.length <= 1) {
      return `${drive}\\`
    }

    return `${drive}\\${parts.slice(0, -1).join('\\')}`
  }

  if (windowsPath.startsWith('\\\\')) {
    const parts = splitWindowsUncPath(windowsPath)
    if (parts.length <= 2) {
      return `\\\\${parts.join('\\')}`
    }
    return `\\\\${parts.slice(0, -1).join('\\')}`
  }

  const posixParts = path.split('/').filter(Boolean)
  if (posixParts.length <= 1) {
    return '/'
  }

  return `/${posixParts.slice(0, -1).join('/')}`
}
