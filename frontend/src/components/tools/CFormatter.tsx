import React, { useState, useEffect } from 'react'
import { Card, Input, Button, Space, message, InputNumber } from 'antd'
import { FormatPainterOutlined, CopyOutlined, ClearOutlined } from '@ant-design/icons'
import './CFormatter.css'

const { TextArea } = Input

const CFormatter: React.FC = () => {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [indentSize, setIndentSize] = useState(2)

  const formatC = (code: string, indent: number): string => {
    if (!code.trim()) return ''

    let formatted = code
    let indentLevel = 0

    // Remove existing indentation and normalize whitespace
    formatted = formatted.replace(/^\s+/gm, '')
    
    // Add spaces around operators for better readability
    formatted = formatted.replace(/([+\-*/%=<>!&|^])=/g, ' $1= ')
    formatted = formatted.replace(/([^+\-*/%=<>!&|^])([+\-*/%<>])/g, '$1 $2 ')
    formatted = formatted.replace(/\s+/g, ' ')

    // Split into lines
    const lines = formatted.split('\n')
    const formattedLines: string[] = []

    for (let i = 0; i < lines.length; i++) {
      let line = lines[i].trim()
      if (!line) {
        formattedLines.push('')
        continue
      }

      // Handle multiple statements on one line
      if (line.includes(';') && line.includes('{')) {
        const parts = line.split('{')
        line = parts[0].trim() + ' {'
        if (parts[1] && parts[1].trim()) {
          lines.splice(i + 1, 0, parts[1])
        }
      }

      // Decrease indent for closing braces
      if (line.startsWith('}')) {
        indentLevel = Math.max(0, indentLevel - 1)
      }

      // Handle case/default in switch statements
      if (line.startsWith('case ') || line.startsWith('default:')) {
        const caseIndent = ' '.repeat(Math.max(0, indentLevel - 1) * indent)
        formattedLines.push(caseIndent + line)
        continue
      }

      // Add indentation
      const indentStr = ' '.repeat(indentLevel * indent)
      formattedLines.push(indentStr + line)

      // Increase indent for opening braces
      if (line.endsWith('{')) {
        indentLevel++
      }

      // Handle } else { on same line
      if (line.includes('} else {')) {
        // Already handled by the brace logic
      } else if (line.startsWith('}') && line.endsWith('{')) {
        indentLevel++
      }
    }

    return formattedLines.join('\n')
  }

  useEffect(() => {
    // Auto-format when input changes
    if (input.trim()) {
      try {
        const formatted = formatC(input, indentSize)
        setOutput(formatted)
      } catch (err) {
        // Silently fail for auto-format
      }
    } else {
      setOutput('')
    }
  }, [input, indentSize])

  const handleFormat = () => {
    if (!input.trim()) {
      message.warning('Please enter C code to format')
      return
    }

    try {
      const formatted = formatC(input, indentSize)
      setOutput(formatted)
      message.success('C code formatted successfully')
    } catch (err) {
      message.error('Failed to format C code')
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

  return (
    <div className="c-formatter">
      <Card title="C Formatter" className="formatter-card">
        <div className="formatter-controls">
          <Space wrap>
            <span className="indent-label">Indent Size:</span>
            <InputNumber
              min={2}
              max={8}
              value={indentSize}
              onChange={(value) => setIndentSize(value || 2)}
              className="indent-input"
            />
            <Button
              type="primary"
              icon={<FormatPainterOutlined />}
              onClick={handleFormat}
            >
              Format
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
            <div className="formatter-label">Input C Code</div>
            <TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Enter C code here, e.g., int main(){int x=10;if(x>5){printf("Hello");return 0;}return 1;}'
              rows={12}
              className="formatter-textarea"
            />
          </div>

          <div className="formatter-output">
            <div className="formatter-label">Formatted C Code</div>
            <TextArea
              value={output}
              readOnly
              placeholder="Formatted C code will appear here"
              rows={12}
              className="formatter-textarea formatter-textarea-output"
            />
          </div>
        </div>
      </Card>
    </div>
  )
}

export default CFormatter
