/**
 * Escape a file path for safe use in shell commands
 * 
 * @param path - The file path to escape
 * @returns The escaped path, wrapped in single quotes if it contains special characters
 * 
 * @example
 * escapeShellPath('/path/to/file.txt') // => '/path/to/file.txt'
 * escapeShellPath('/path/with spaces/file.txt') // => "'/path/with spaces/file.txt'"
 * escapeShellPath("/path/with'quote.txt") // => "'/path/with'\''quote.txt'"
 */
export function escapeShellPath(path: string): string {
  // Check if path contains special characters that need escaping
  // Including: space, quotes, dollar sign, backslash, exclamation, asterisk, question mark,
  // parentheses, ampersand, pipe, angle brackets, semicolon, brackets, braces, tilde, backtick, hash
  if (/[\s'"$\\!*?()&|<>;\[\]{}~`#]/.test(path)) {
    // Wrap in single quotes and escape any existing single quotes
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
