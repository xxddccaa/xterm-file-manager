import React, { useState, useEffect } from 'react'
import { Card, Input, Button, Space, message, Radio, Segmented } from 'antd'
import { 
  FormatPainterOutlined, 
  CopyOutlined, 
  ClearOutlined,
  PlusOutlined,
  MinusOutlined
} from '@ant-design/icons'
import './JsonFormatter.css'

const { TextArea } = Input

type FormatMode = 'pretty' | 'compact'
type ViewMode = 'text' | 'tree'

interface JsonTreeNodeProps {
  data: any
  name?: string
  isLast?: boolean
  level?: number
}

const JsonTreeNode: React.FC<JsonTreeNodeProps> = ({ data, name, isLast = true, level = 0 }) => {
  const [collapsed, setCollapsed] = useState(false)

  const isObject = typeof data === 'object' && data !== null && !Array.isArray(data)
  const isArray = Array.isArray(data)
  const isCollapsible = isObject || isArray

  const getValueType = (val: any): string => {
    if (val === null) return 'null'
    if (typeof val === 'boolean') return 'boolean'
    if (typeof val === 'number') return 'number'
    if (typeof val === 'string') return 'string'
    return ''
  }

  const renderValue = (val: any) => {
    if (val === null) return <span className="json-null">null</span>
    if (typeof val === 'boolean') return <span className="json-boolean">{val.toString()}</span>
    if (typeof val === 'number') return <span className="json-number">{val}</span>
    if (typeof val === 'string') return <span className="json-string">"{val}"</span>
    return null
  }

  const getPreview = () => {
    if (isObject) {
      const keys = Object.keys(data)
      return `{${keys.length} ${keys.length === 1 ? 'key' : 'keys'}}`
    }
    if (isArray) {
      return `[${data.length} ${data.length === 1 ? 'item' : 'items'}]`
    }
    return ''
  }

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    setCollapsed(!collapsed)
  }

  return (
    <div className={`json-node level-${level}`}>
      <div className="json-node-line">
        {isCollapsible && (
          <span className="json-toggle" onClick={handleToggle}>
            {collapsed ? <PlusOutlined /> : <MinusOutlined />}
          </span>
        )}
        {!isCollapsible && <span className="json-toggle-placeholder"></span>}
        
        {name !== undefined && (
          <>
            <span className="json-key">"{name}"</span>
            <span className="json-colon">: </span>
          </>
        )}

        {isCollapsible ? (
          <>
            <span className="json-bracket">{isArray ? '[' : '{'}</span>
            {collapsed && (
              <>
                <span className="json-preview">{getPreview()}</span>
                <span className="json-bracket">{isArray ? ']' : '}'}</span>
              </>
            )}
          </>
        ) : (
          renderValue(data)
        )}
        
        {!isCollapsible && !isLast && <span className="json-comma">,</span>}
      </div>

      {isCollapsible && !collapsed && (
        <div className="json-children">
          {isObject && Object.entries(data).map(([key, value], index, arr) => (
            <JsonTreeNode
              key={key}
              name={key}
              data={value}
              isLast={index === arr.length - 1}
              level={level + 1}
            />
          ))}
          {isArray && data.map((item: any, index: number) => (
            <JsonTreeNode
              key={index}
              data={item}
              isLast={index === data.length - 1}
              level={level + 1}
            />
          ))}
          <div className="json-node-line">
            <span className="json-toggle-placeholder"></span>
            <span className="json-bracket">{isArray ? ']' : '}'}</span>
            {!isLast && <span className="json-comma">,</span>}
          </div>
        </div>
      )}
    </div>
  )
}

const JsonFormatter: React.FC = () => {
  const [input, setInput] = useState('')
  const [parsedData, setParsedData] = useState<any>(null)
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')
  const [mode, setMode] = useState<FormatMode>('pretty')
  const [viewMode, setViewMode] = useState<ViewMode>('tree')

  useEffect(() => {
    // Auto-format when input changes and is valid JSON
    if (input.trim()) {
      try {
        const parsed = JSON.parse(input)
        setParsedData(parsed)
        const formatted = mode === 'pretty'
          ? JSON.stringify(parsed, null, 2)
          : JSON.stringify(parsed)
        setOutput(formatted)
        setError('')
      } catch (err) {
        setParsedData(null)
        const errorMessage = err instanceof Error ? err.message : 'Invalid JSON'
        setError(errorMessage)
      }
    } else {
      setParsedData(null)
      setOutput('')
      setError('')
    }
  }, [input, mode])

  const handleFormat = () => {
    if (!input.trim()) {
      message.warning('Please enter JSON to format')
      return
    }

    try {
      const parsed = JSON.parse(input)
      setParsedData(parsed)
      const formatted = mode === 'pretty'
        ? JSON.stringify(parsed, null, 2)
        : JSON.stringify(parsed)
      setOutput(formatted)
      setError('')
      message.success('JSON formatted successfully')
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Invalid JSON'
      setError(errorMessage)
      setParsedData(null)
      setOutput('')
      message.error('Invalid JSON format')
    }
  }

  const handleCopy = () => {
    const textToCopy = viewMode === 'text' ? output : JSON.stringify(parsedData, null, 2)
    if (!textToCopy) {
      message.warning('No JSON to copy')
      return
    }
    navigator.clipboard.writeText(textToCopy)
    message.success('Copied to clipboard')
  }

  const handleClear = () => {
    setInput('')
    setOutput('')
    setParsedData(null)
    setError('')
  }

  const handleExpandAll = () => {
    // Force re-render to expand all nodes
    const temp = parsedData
    setParsedData(null)
    setTimeout(() => setParsedData(temp), 0)
  }

  return (
    <div className="json-formatter">
      <Card title="JSON Formatter" className="formatter-card">
        <div className="formatter-controls">
          <Space wrap>
            <Segmented
              value={viewMode}
              onChange={(value) => setViewMode(value as ViewMode)}
              options={[
                { label: 'Tree View', value: 'tree' },
                { label: 'Text View', value: 'text' },
              ]}
            />
            {viewMode === 'text' && (
              <Radio.Group value={mode} onChange={(e) => setMode(e.target.value)}>
                <Radio.Button value="pretty">Pretty</Radio.Button>
                <Radio.Button value="compact">Compact</Radio.Button>
              </Radio.Group>
            )}
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
              disabled={!parsedData}
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
            <div className="formatter-label">Input JSON</div>
            <TextArea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder='Enter JSON here, e.g., {"name":"John","age":30,"address":{"city":"NYC"}}'
              rows={12}
              className="formatter-textarea"
            />
            {error && <div className="formatter-error">{error}</div>}
          </div>

          <div className="formatter-output">
            <div className="formatter-label">
              {viewMode === 'tree' ? 'Tree View' : 'Formatted JSON'}
            </div>
            {viewMode === 'text' ? (
              <TextArea
                value={output}
                readOnly
                placeholder="Formatted JSON will appear here"
                rows={12}
                className="formatter-textarea formatter-textarea-output"
              />
            ) : (
              <div className="json-tree-container">
                {parsedData ? (
                  <JsonTreeNode data={parsedData} />
                ) : (
                  <div className="json-tree-placeholder">
                    Formatted JSON tree will appear here
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}

export default JsonFormatter
