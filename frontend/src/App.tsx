import React, { useEffect, useState } from 'react';
import { ConfigProvider, theme, Modal, List, Input, Button, Spin } from 'antd';
import { Layout } from 'antd';
import { SearchOutlined, PlusOutlined, FolderOutlined } from '@ant-design/icons';
import SessionTabs from './components/session/SessionTabs';
import SessionView from './components/session/SessionView';
import { SSHConfigEntry } from './types';
import './App.css';

const { Sider, Content } = Layout;

interface ActiveSession {
  id: string;
  config: SSHConfigEntry;
  title: string;
  connected: boolean;
}

const App: React.FC = () => {
  const [sshConfigs, setSSHConfigs] = useState<SSHConfigEntry[]>([]);
  const [sessions, setSessions] = useState<ActiveSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [wailsReady, setWailsReady] = useState(false);
  const [showServerModal, setShowServerModal] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [siderCollapsed, setSiderCollapsed] = useState(false);

  useEffect(() => {
    console.log('🚀 App component mounted');
    
    const checkWails = () => {
      if ((window as any).go?.main?.App) {
        console.log('✅ Wails runtime found!');
        setWailsReady(true);
        loadSSHConfig();
      } else {
        console.log('⏳ Waiting for Wails runtime...');
        setTimeout(checkWails, 100);
      }
    };
    
    setTimeout(checkWails, 200);
  }, []);

  const loadSSHConfig = async () => {
    try {
      setLoading(true);
      
      if ((window as any).go?.main?.App?.GetSSHConfig) {
        const configs = await (window as any).go.main.App.GetSSHConfig();
        console.log('✅ Loaded SSH configs:', configs);
        setSSHConfigs(configs || []);
      }
    } catch (error: any) {
      console.error('❌ Failed to load SSH config:', error);
      setSSHConfigs([]);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSession = (config: SSHConfigEntry) => {
    const sessionId = `${config.host}-${Date.now()}`;
    const newSession: ActiveSession = {
      id: sessionId,
      config,
      title: config.host,
      connected: false,
    };

    setSessions([...sessions, newSession]);
    setActiveSessionId(sessionId);
    setShowServerModal(false);
  };

  const handleCloseSession = (sessionId: string) => {
    setSessions(sessions.filter(s => s.id !== sessionId));
    if (activeSessionId === sessionId && sessions.length > 0) {
      const idx = sessions.findIndex(s => s.id === sessionId);
      const newIdx = idx > 0 ? idx - 1 : 0;
      if (sessions[newIdx] && sessions[newIdx].id !== sessionId) {
        setActiveSessionId(sessions[newIdx].id);
      } else {
        setActiveSessionId('');
      }
    }
  };

  const handleSessionConnected = (sessionId: string, connected: boolean) => {
    setSessions(sessions.map(s => 
      s.id === sessionId ? { ...s, connected } : s
    ));
  };

  const handleNewSession = () => {
    setShowServerModal(true);
  };

  const filteredConfigs = sshConfigs.filter(config =>
    config.host.toLowerCase().includes(searchText.toLowerCase()) ||
    config.user?.toLowerCase().includes(searchText.toLowerCase())
  );

  if (!wailsReady) {
    return (
      <div className="loading-screen">
        <Spin size="large" />
        <p>Initializing XTerm File Manager...</p>
      </div>
    );
  }

  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1890ff',
          colorBgContainer: '#1e1e1e',
          colorBgElevated: '#252525',
        },
        algorithm: theme.darkAlgorithm,
      }}
    >
      <Layout className="app-layout">
        {/* Sidebar for server list */}
        <Sider
          collapsible
          collapsed={siderCollapsed}
          onCollapse={setSiderCollapsed}
          width={280}
          className="app-sider"
        >
          <div className="sider-header">
            <FolderOutlined className="header-icon" />
            {!siderCollapsed && <h2>SSH Servers</h2>}
          </div>

          {!siderCollapsed && (
            <>
              <div className="sider-actions">
                <Input
                  placeholder="Search servers..."
                  prefix={<SearchOutlined />}
                  value={searchText}
                  onChange={(e) => setSearchText(e.target.value)}
                  className="search-input"
                />
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={handleNewSession}
                  block
                  style={{ marginTop: 10 }}
                >
                  New Session
                </Button>
              </div>

              <div className="server-list">
                {loading ? (
                  <div className="list-loading">
                    <Spin />
                    <p>Loading servers...</p>
                  </div>
                ) : filteredConfigs.length > 0 ? (
                  <List
                    dataSource={filteredConfigs}
                    renderItem={(config) => (
                      <List.Item
                        className="server-item"
                        onClick={() => handleCreateSession(config)}
                      >
                        <div className="server-info">
                          <div className="server-host">{config.host}</div>
                          <div className="server-details">
                            {config.user}@{config.hostname || config.host}:{config.port}
                          </div>
                        </div>
                      </List.Item>
                    )}
                  />
                ) : (
                  <div className="empty-state">
                    <p>No servers found</p>
                    <p className="hint">Add servers to ~/.ssh/config</p>
                  </div>
                )}
              </div>
            </>
          )}
        </Sider>

        {/* Main content area */}
        <Layout className="main-layout">
          {sessions.length > 0 && (
            <SessionTabs
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSessionChange={setActiveSessionId}
              onSessionClose={handleCloseSession}
              onNewSession={handleNewSession}
            />
          )}

          <Content className="main-content">
            {sessions.length === 0 ? (
              <div className="welcome-screen">
                <div className="welcome-content">
                  <h1>Welcome to XTerm File Manager</h1>
                  <p>Professional SSH terminal and file manager</p>
                  <Button
                    type="primary"
                    size="large"
                    icon={<PlusOutlined />}
                    onClick={handleNewSession}
                  >
                    Create New Session
                  </Button>
                  {sshConfigs.length === 0 && (
                    <p className="hint">No SSH config found. Add servers to ~/.ssh/config</p>
                  )}
                </div>
              </div>
            ) : (
              sessions.map(session => (
                <div
                  key={session.id}
                  style={{
                    display: session.id === activeSessionId ? 'flex' : 'none',
                    height: '100%',
                    width: '100%',
                    minWidth: 0,
                    flex: '1 1 0',
                    overflow: 'hidden',
                  }}
                >
                  <SessionView
                    sessionId={session.id}
                    config={session.config}
                    onClose={() => handleCloseSession(session.id)}
                    onConnectionChange={(connected) => handleSessionConnected(session.id, connected)}
                  />
                </div>
              ))
            )}
          </Content>
        </Layout>

        {/* Server selection modal */}
        <Modal
          title="Select Server"
          open={showServerModal}
          onCancel={() => setShowServerModal(false)}
          footer={null}
          width={600}
        >
          <Input
            placeholder="Search servers..."
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ marginBottom: 15 }}
          />
          <List
            dataSource={filteredConfigs}
            renderItem={(config) => (
              <List.Item
                className="modal-server-item"
                onClick={() => handleCreateSession(config)}
              >
                <div className="server-info">
                  <div className="server-host">{config.host}</div>
                  <div className="server-details">
                    {config.user}@{config.hostname || config.host}:{config.port}
                  </div>
                </div>
              </List.Item>
            )}
          />
        </Modal>
      </Layout>
    </ConfigProvider>
  );
};

export default App;
