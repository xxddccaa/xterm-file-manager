# 调试白屏问题

## 已完成的修复

1. ✅ 添加了 `Bind: []interface{}{app}` 到 main.go
2. ✅ 改进了前端错误处理和调试信息
3. ✅ 添加了加载状态显示
4. ✅ 重新构建了前端

## 如果还是白屏，请按以下步骤：

### 1. 停止当前运行的应用
按 `Ctrl+C` 停止 `wails dev`

### 2. 重新构建前端
```bash
cd frontend
npm run build
cd ..
```

### 3. 重新运行
```bash
export PATH=$PATH:$(go env GOPATH)/bin
wails dev
```

### 4. 检查浏览器控制台
- 如果 Wails 窗口打开了，尝试打开开发者工具
- 查看是否有 JavaScript 错误
- 查看是否有资源加载失败

### 5. 测试 Web 版本
Wails 提示可以在浏览器中测试：
```
To develop in the browser and call your bound Go methods from Javascript, navigate to: http://localhost:34115
```

在浏览器中打开 `http://localhost:34115`，看看是否能正常显示。

### 6. 检查文件
```bash
# 确认 dist 目录存在
ls -la frontend/dist/

# 确认 index.html 存在
cat frontend/dist/index.html

# 确认资源文件存在
ls -la frontend/dist/assets/
```

### 7. 如果浏览器版本能显示，但应用窗口白屏
可能是 Wails 的资源加载问题。尝试：
- 检查 `main.go` 中的 `//go:embed all:frontend/dist` 是否正确
- 确认 `frontend/dist` 目录在正确的位置

### 8. 查看终端输出
检查是否有错误信息，特别是：
- "Error loading assets"
- "Failed to serve"
- 任何 Go 编译错误

## 常见问题

**Q: 浏览器能显示，但应用窗口白屏？**
A: 可能是 Wails 的资源嵌入问题。尝试重新构建：
```bash
go clean -cache
wails build
```

**Q: 完全白屏，没有任何内容？**
A: 检查浏览器控制台，可能是 React 渲染失败。查看是否有：
- "Cannot read property..."
- "Uncaught Error..."
- 资源 404 错误
