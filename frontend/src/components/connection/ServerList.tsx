import React from 'react';
import { List, Input, Button, Spin } from 'antd';
import { SearchOutlined, CloudServerOutlined, ReloadOutlined } from '@ant-design/icons';
import { SSHConfigEntry } from '../../types';
import './ServerList.css';

interface ServerListProps {
  configs: SSHConfigEntry[];
  onSelectServer: (config: SSHConfigEntry) => void;
  onRefresh: () => void;
}

const ServerList: React.FC<ServerListProps> = ({ configs, onSelectServer, onRefresh }) => {
  const [searchText, setSearchText] = React.useState('');

  const filteredConfigs = configs.filter(
    (config) =>
      config.host.toLowerCase().includes(searchText.toLowerCase()) ||
      config.hostname?.toLowerCase().includes(searchText.toLowerCase())
  );

  return (
    <div className="server-list">
      <div className="server-list-header">
        <Input
          prefix={<SearchOutlined />}
          placeholder="Search servers..."
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          allowClear
        />
        <Button
          icon={<ReloadOutlined />}
          onClick={onRefresh}
          style={{ marginTop: 8, width: '100%' }}
        >
          Refresh
        </Button>
      </div>
      <List
        dataSource={filteredConfigs}
        renderItem={(config) => (
          <List.Item
            className="server-list-item"
            onClick={() => onSelectServer(config)}
          >
            <List.Item.Meta
              avatar={<CloudServerOutlined />}
              title={config.host}
              description={
                <div>
                  {config.hostname && (
                    <div>
                      {config.hostname}:{config.port || 22}
                    </div>
                  )}
                  {config.user && <div>User: {config.user}</div>}
                </div>
              }
            />
          </List.Item>
        )}
      />
      {filteredConfigs.length === 0 && (
        <div className="server-list-empty">
          {searchText ? 'No servers found' : 'No SSH config found. Add servers to ~/.ssh/config'}
        </div>
      )}
    </div>
  );
};

export default ServerList;
