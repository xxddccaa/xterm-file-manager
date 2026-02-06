# 快速启动指南

## 已完成的设置

项目已经基于 **Go + Wails** 重构完成，比 Electron 更轻量！

## 运行应用

### 方法 1: 开发模式（推荐）

```bash
cd /Users/xd/Documents/xiedong_dev/mac_code/xterm-file-manager

# 确保 Wails CLI 在 PATH 中
export PATH=$PATH:$(go env GOPATH)/bin

# 运行开发模式（会自动启动前端和后端）
wails dev
```

### 方法 2: 构建后运行

```bash
# 构建应用
wails build

# 运行构建的应用
./build/bin/xterm-file-manager.app/Contents/MacOS/xterm-file-manager
```

## 当前功能

✅ **SSH Config 解析** - 自动读取 `~/.ssh/config`  
✅ **服务器列表显示** - 左侧边栏显示所有 SSH 配置  
✅ **基础 UI** - 文件管理器和终端界面框架  
⏳ **SSH 连接** - 待实现  
⏳ **SFTP 文件操作** - 待实现  
⏳ **终端交互** - 待实现  

## 项目结构

```
xterm-file-manager/
├── main.go              # 应用入口
├── internal/app/        # 业务逻辑包
│   ├── app.go           # App 结构和方法
│   ├── ssh.go           # SSH 配置解析
│   ├── ssh_manager.go   # SSH 连接管理
│   ├── websocket_handler.go  # 终端 I/O
│   └── local_files.go   # 文件操作
├── frontend/            # React 前端
│   ├── src/
│   ├── wailsjs/go/app/  # Wails 绑定
│   └── dist/            # 构建输出
└── wails.json           # Wails 配置
```

## 技术栈

- **后端**: Go + Wails v2
- **前端**: React + TypeScript + Vite
- **UI**: Ant Design
- **终端**: xterm.js

## 下一步开发

1. 实现 SSH 连接（使用 `golang.org/x/crypto/ssh`）
2. 实现 SFTP 文件操作
3. 实现终端交互（WebSocket 或类似机制）
4. 添加端口转发功能

应用现在应该已经启动了！如果看到窗口，说明运行成功。
