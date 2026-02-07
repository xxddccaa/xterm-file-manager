/**
 * Logger utility that writes to both console and user-specific log file.
 * Log path is managed by the Go backend (getDebugLogPath):
 *   macOS: ~/Library/Logs/xterm-file-manager/debug.log
 *   Linux: ~/.cache/xterm-file-manager/debug.log
 */

class Logger {
  private logBuffer: string[] = [];
  private flushInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.log('🚀 [Logger] Initialized at', new Date().toISOString());
    
    // Flush logs every 500ms
    this.flushInterval = setInterval(() => {
      this.flush();
    }, 500);
  }

  log(...args: any[]) {
    const timestamp = new Date().toISOString();
    const message = args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)
    ).join(' ');
    
    const logLine = `[${timestamp}] ${message}`;
    
    // Console output
    console.log(...args);
    
    // Buffer for file output
    this.logBuffer.push(logLine);
    
    // If buffer is too large, flush immediately
    if (this.logBuffer.length > 50) {
      this.flush();
    }
  }

  async flush() {
    if (this.logBuffer.length === 0) return;
    
    const logs = this.logBuffer.join('\n') + '\n';
    this.logBuffer = [];
    
    try {
      // Write to backend log file via Wails
      if ((window as any).go?.app?.App?.WriteDebugLog) {
        await (window as any).go.app.App.WriteDebugLog(logs);
      }
    } catch (err) {
      console.error('Failed to write debug log:', err);
    }
  }

  destroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flush();
  }
}

const logger = new Logger();

// Flush logs before page unload
window.addEventListener('beforeunload', () => {
  logger.flush();
});

export default logger;
