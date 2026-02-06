import React, { useState, useEffect } from 'react'
import { Card, Input, Button, Space, message, Radio } from 'antd'
import { SwapOutlined, CopyOutlined, ClearOutlined, SyncOutlined } from '@ant-design/icons'
import './EscapeTool.css'

const { TextArea } = Input

type EscapeMode = 'escape' | 'unescape'

const EscapeTool: React.FC = () => {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [mode, setMode] = useState<EscapeMode>('unescape')

  const unescapeString = (str: string): string => {
    // Handle common escape sequences
    return str
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\b/g, '\b')
      .replace(/\\f/g, '\f')
      .replace(/\\v/g, '\v')
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\\0/g, '\0')
      .replace(/\\\\/g, '\\')
  }

  const escapeString = (str: string): string => {
    // Escape special characters
    return str
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(/\r/g, '\\r')
      .replace(/\b/g, '\\b')
      .replace(/\f/g, '\\f')
      .replace(/\v/g, '\\v')
      .replace(/"/g, '\\"')
      .replace(/'/g, "\\'")
      .replace(/\0/g, '\\0')
  }

  useEffect(() => {
    // Auto-convert when input changes
    if (input) {
      try {
        const result = mode === 'unescape'
          ? unescapeString(input)
          : escapeString(input)
        setOutput(result)
      } catch (err) {
        // Silently fail for auto-convert
      }
    } else {
      setOutput('')
    }
  }, [input, mode])

  const handleConvert = () => {
    if (!input.trim()) {
      message.warning('Please enter text to convert')
      return
    }

    try {
      const result = mode === 'unescape'
        ? unescapeString(input)
        : escapeString(input)
      setOutput(result)
      message.success('Conversion completed successfully')
    } catch (err) {
      message.error('Failed to convert text')
    }
  }

  const handleSwap = () => {
    if (output) {
      const temp = input
      setInput(output)
      setOutput(temp)
      message.success('Input and output swapped')
    }
  }

  const handleCopy = () => {
    if (!output) {
      message.warning('No output to copy')
      return
    }
    navigator.clipboard.writeText(output)
    message.success('Copied to clipboard')
  }

  const handleClear = () => {
    setInput('')
    setOutput('')
  }

  const handleToggleMode = () => {
    setMode(mode === 'escape' ? 'unescape' : 'escape')
  }

  return (
    <div className="escape-tool">
      <Card title="Escape Tool" className="formatter-card">
        <div className="formatter-controls">
          <Space wrap>
            <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
              <Radio.Button value="unescape">Unescape</Radio.Button>
              <Radio.Button value="escape">Escape</Radio.Button>
            </Radio.Group>
            <Button
              type="primary"
              icon={<SwapOutlined />}
              onClick={handleConvert}
            >
              Convert
            </Button>
            <Button
              icon={<SyncOutlined />}
              onClick={handleToggleMode}
            >
              Toggle Mode
            </Button>
            <Button
              icon={<SwapOutlined />}
              onClick={handleSwap}
              disabled={!output}
            >
              Swap I/O
            </Button>
            <Button
              icon={<CopyOutlined />}
              onClick={handleCopy}
              disabled={!output}
            >
              Copy
            </Button>
            <Button
              icon={<ClearOutlined />}
              onClick={handleClear}
            >
              Clear
            </Button>
          </Space>
        </div>

        <div className="formatter-content">
          <div className="formatter-input">
            <div className="formatter-label">
              Input Text {mode === 'unescape' ? '(with escape sequences)' : '(plain text)'}
            </div>
            <TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={mode === 'unescape' 
                ? 'Enter text with escape sequences, e.g., dasd\\nweawe\\t123'
                : 'Enter plain text to escape, e.g., dasd\nweawe\t123'}
              rows={12}
              className="formatter-textarea"
            />
          </div>

          <div className="formatter-output">
            <div className="formatter-label">
              Output {mode === 'unescape' ? '(unescaped)' : '(escaped)'}
            </div>
            <TextArea
              value={output}
              readOnly
              placeholder={mode === 'unescape'
                ? 'Unescaped text will appear here'
                : 'Escaped text will appear here'}
              rows={12}
              className="formatter-textarea formatter-textarea-output"
            />
          </div>
        </div>

        <div className="escape-help">
          <p className="help-title">Supported escape sequences:</p>
          <div className="help-grid">
            <div className="help-column">
              <ul className="help-list">
                <li><code>\\n</code> - Newline</li>
                <li><code>\\t</code> - Tab</li>
                <li><code>\\r</code> - Carriage return</li>
                <li><code>\\b</code> - Backspace</li>
              </ul>
            </div>
            <div className="help-column">
              <ul className="help-list">
                <li><code>\\f</code> - Form feed</li>
                <li><code>\\v</code> - Vertical tab</li>
                <li><code>\\\\</code> - Backslash</li>
                <li><code>\\"</code> / <code>\\'</code> - Quotes</li>
              </ul>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}

export default EscapeTool
