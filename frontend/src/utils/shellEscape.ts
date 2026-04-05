/**
 * Escape a file path for safe use in shell commands.
 *
 * Windows local terminal paths should stay friendly to both `cmd.exe` and
 * PowerShell, so Windows-looking paths use double quotes. POSIX-looking paths
 * keep the stronger single-quote strategy.
 *
 * @param path - The file path to escape
 * @returns The escaped path, wrapped when it contains special characters
 *
 * @example
 * escapeShellPath('/path/to/file.txt') // => '/path/to/file.txt'
 * escapeShellPath('/path/with spaces/file.txt') // => "'/path/with spaces/file.txt'"
 * escapeShellPath('C:\\Program Files\\app.txt') // => "\"C:\\Program Files\\app.txt\""
 */
function isWindowsPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\/.test(path)
}

export function escapeShellPath(path: string): string {
  if (isWindowsPath(path)) {
    // Windows file names cannot contain double quotes, so quoting with "
    // works for cmd.exe and is also accepted by PowerShell.
    if (/[\s&|<>^()]/.test(path)) {
      return `"${path}"`
    }
    return path
  }

  // Check if path contains special characters that need escaping.
  // Including: space, quotes, dollar sign, backslash, exclamation, asterisk,
  // question mark, parentheses, ampersand, pipe, angle brackets, semicolon,
  // brackets, braces, tilde, backtick, hash.
  if (/[\s'"$\\!*?()&|<>;\[\]{}~`#]/.test(path)) {
    // Wrap in single quotes and escape any existing single quotes.
    // Escape strategy: replace ' with '\'' (close quote, escaped quote, open quote)
    return "'" + path.replace(/'/g, "'\\''") + "'"
  }
  return path
}

/**
 * Escape multiple file paths and join them with spaces
 * 
 * @param paths - Array of file paths to escape
 * @returns Space-separated escaped paths
 * 
 * @example
 * escapeShellPaths(['/file1.txt', '/file 2.txt']) // => "/file1.txt '/file 2.txt'"
 */
export function escapeShellPaths(paths: string[]): string {
  return paths.map(escapeShellPath).join(' ')
}
