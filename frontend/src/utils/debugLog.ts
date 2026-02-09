/**
 * In-memory log collector for frontend debugging.
 * Logs are stored in an array and can be displayed in a LogTab UI.
 * Also mirrors to console.log for dev tools.
 */

export interface LogEntry {
  id: number
  time: string
  message: string
}

let logs: LogEntry[] = []
let nextId = 1
let listeners: Array<() => void> = []
const MAX_LOGS = 500

function now(): string {
  const d = new Date()
  return d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
}

export function dlog(msg: string): void {
  const entry: LogEntry = { id: nextId++, time: now(), message: msg }
  logs.push(entry)
  if (logs.length > MAX_LOGS) {
    logs = logs.slice(-MAX_LOGS)
  }
  console.log(msg)
  // Notify subscribers
  listeners.forEach(fn => fn())
}

export function getLogs(): LogEntry[] {
  return logs
}

export function clearLogs(): void {
  logs = []
  nextId = 1
  listeners.forEach(fn => fn())
}

export function subscribeLogs(fn: () => void): () => void {
  listeners.push(fn)
  return () => {
    listeners = listeners.filter(l => l !== fn)
  }
}
