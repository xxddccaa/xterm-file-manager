# 运行应用

## 如果看到白屏，请按以下步骤操作：

### 1. 确保前端已构建
```bash
cd frontend
npm run build
cd ..
```

### 2. 运行应用
```bash
export PATH=$PATH:$(go env GOPATH)/bin
wails dev
```

### 3. 检查控制台
- 打开开发者工具（如果 Wails 支持）
- 查看浏览器控制台是否有错误
- 检查是否有 "Wails runtime not available" 警告

### 4. 如果还是白屏
- 检查 `frontend/dist` 目录是否存在（不要删除整个目录，只删 assets）
- 检查 `frontend/dist/index.html` 是否正确
- 尝试清理缓存重新构建：
  ```bash
  rm -rf frontend/dist/assets
  cd frontend && rm -rf node_modules/.vite .vite && npm install && npm run build && cd ..
  ```

### 5. 调试模式
在 `main.go` 中，确保 `Bind: []interface{}{app}` 已设置，这样 Go 方法才能暴露给前端。

## 常见问题

**Q: 白屏怎么办？**
A: 
1. 检查前端是否构建成功
2. 检查浏览器控制台错误
3. 确保 `Bind` 选项在 main.go 中正确设置

**Q: 看不到 SSH 配置？**
A: 
1. 检查 `~/.ssh/config` 文件是否存在
2. 检查控制台是否有错误信息
3. 尝试点击 "Refresh" 按钮
