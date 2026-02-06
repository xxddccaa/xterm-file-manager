import React, { Component, ErrorInfo, ReactNode } from 'react'
import { Button, Result } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('❌ Error caught by boundary:', error, errorInfo)
    this.setState({
      error,
      errorInfo,
    })
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    })
    // Reload the page to reset state
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ 
          height: '100vh', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          background: '#1e1e1e',
          color: '#fff'
        }}>
          <Result
            status="error"
            title="Application Error"
            subTitle={this.state.error?.message || 'An unexpected error occurred'}
            extra={[
              <Button 
                key="reload" 
                type="primary" 
                icon={<ReloadOutlined />}
                onClick={this.handleReset}
              >
                Reload Application
              </Button>,
            ]}
          >
            {this.state.errorInfo && (
              <div style={{ 
                textAlign: 'left', 
                maxWidth: '600px', 
                margin: '20px auto',
                padding: '10px',
                background: '#2d2d2d',
                borderRadius: '4px',
                fontSize: '12px',
                fontFamily: 'monospace',
                overflow: 'auto',
                maxHeight: '300px'
              }}>
                <pre style={{ margin: 0, color: '#ff6b6b' }}>
                  {this.state.errorInfo.componentStack}
                </pre>
              </div>
            )}
          </Result>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
