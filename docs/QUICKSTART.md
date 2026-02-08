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
# 清理缓存 + 构建
rm -rf build/bin/* frontend/dist/assets
cd frontend && rm -rf node_modules/.vite .vite && cd ..
wails build -platform darwin/arm64 -clean

# 运行构建的应用
pkill -f xterm-file-manager 2>/dev/null; sleep 1
open build/bin/xterm-file-manager.app
```

## 当前功能

✅ **SSH Config 解析** - 自动读取 `~/.ssh/config`  
✅ **服务器列表显示** - 左侧边栏显示所有 SSH 配置  
✅ **SSH 连接** - 点击服务器即可连接  
✅ **SFTP 文件操作** - 远程文件浏览、上传、下载、删除、重命名  
✅ **终端交互** - 完整的 xterm.js 终端模拟器  
✅ **本地终端** - 支持本地 shell 终端  
✅ **文件编辑器** - 多标签编辑器，支持 30+ 语言语法高亮  
✅ **拖拽支持** - 拖拽文件到终端或编辑器  

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

参考 `README.md` 和 `docs/工程总结.md` 了解最新开发进展。
