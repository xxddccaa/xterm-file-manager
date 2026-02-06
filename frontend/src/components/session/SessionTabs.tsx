import React from 'react';
import { Tabs, Button, Tooltip } from 'antd';
import { PlusOutlined, CloseOutlined } from '@ant-design/icons';
import './SessionTabs.css';

interface Session {
  id: string;
  title: string;
  host: string;
  connected: boolean;
}

interface SessionTabsProps {
  sessions: Session[];
  activeSessionId: string;
  onSessionChange: (sessionId: string) => void;
  onSessionClose: (sessionId: string) => void;
  onNewSession: () => void;
}

const SessionTabs: React.FC<SessionTabsProps> = ({
  sessions,
  activeSessionId,
  onSessionChange,
  onSessionClose,
  onNewSession,
}) => {
  const items = sessions.map((session) => ({
    key: session.id,
    label: (
      <div className="session-tab-label">
        <span className={`connection-status ${session.connected ? 'connected' : 'disconnected'}`} />
        <span className="session-title">{session.title}</span>
        <CloseOutlined
          className="close-icon"
          onClick={(e) => {
            e.stopPropagation();
            onSessionClose(session.id);
          }}
        />
      </div>
    ),
  }));

  const operations = (
    <Tooltip title="New Session">
      <Button
        type="text"
        icon={<PlusOutlined />}
        onClick={onNewSession}
        className="new-session-btn"
      />
    </Tooltip>
  );

  return (
    <div className="session-tabs-container">
      <Tabs
        type="card"
        activeKey={activeSessionId}
        onChange={onSessionChange}
        tabBarExtraContent={operations}
        items={items}
        hideAdd
      />
    </div>
  );
};

export default SessionTabs;
