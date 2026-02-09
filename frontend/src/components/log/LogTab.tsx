import React, { useState, useEffect, useRef } from 'react'
import { Button } from 'antd'
import { ClearOutlined, CopyOutlined } from '@ant-design/icons'
import { getLogs, clearLogs, subscribeLogs, LogEntry } from '../../utils/debugLog'

const LogTab: React.FC = () => {
  const [logs, setLogs] = useState<LogEntry[]>(getLogs())
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsub = subscribeLogs(() => {
      setLogs([...getLogs()])
    })
    return unsub
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  const handleClear = () => {
    clearLogs()
  }

  const handleCopy = () => {
    const text = logs.map(l => `[${l.time}] ${l.message}`).join('\n')
    navigator.clipboard.writeText(text).catch(() => {})
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#1e1e1e' }}>
      <div style={{ padding: '8px 12px', display: 'flex', gap: 8, borderBottom: '1px solid #333' }}>
        <Button size="small" icon={<CopyOutlined />} onClick={handleCopy}>
          Copy All
        </Button>
        <Button size="small" icon={<ClearOutlined />} onClick={handleClear} danger>
          Clear
        </Button>
        <span style={{ color: '#888', fontSize: 12, lineHeight: '24px' }}>
          {logs.length} entries
        </span>
      </div>
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: '8px 12px',
        fontFamily: 'monospace',
        fontSize: 12,
        lineHeight: '20px',
        color: '#d4d4d4',
        userSelect: 'text',
      }}>
        {logs.length === 0 ? (
          <div style={{ color: '#666', padding: 20, textAlign: 'center' }}>
            No logs yet. Drag a file to the terminal to see debug logs.
          </div>
        ) : (
          logs.map(entry => (
            <div key={entry.id} style={{ borderBottom: '1px solid #2a2a2a', padding: '2px 0' }}>
              <span style={{ color: '#888' }}>[{entry.time}]</span>{' '}
              <span>{entry.message}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

export default LogTab
