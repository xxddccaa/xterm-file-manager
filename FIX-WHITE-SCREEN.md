# 修复白屏问题

## 问题诊断

服务器正常运行在 `http://localhost:34115`，但应用窗口显示白屏。

## 解决方案

### 方法 1: 在浏览器中测试（推荐）

1. **打开浏览器访问**：
   ```bash
   open http://localhost:34115
   ```
   或者手动在浏览器中输入：`http://localhost:34115`

2. **如果浏览器能正常显示**：
   - 说明前端代码正常
   - 问题在 Wails 窗口的资源加载
   - 需要重新构建并重启应用

3. **如果浏览器也白屏**：
   - 检查浏览器控制台（F12）
   - 查看是否有 JavaScript 错误
   - 检查资源是否加载失败

### 方法 2: 重新构建并重启

```bash
# 1. 停止当前运行的 wails dev (Ctrl+C)

# 2. 重新构建前端
cd frontend
npm run build
cd ..

# 3. 清理 Go 缓存
go clean -cache

# 4. 重新运行
export PATH=$PATH:$(go env GOPATH)/bin
wails dev
```

### 方法 3: 检查资源路径

确保 `main.go` 中的嵌入路径正确：
```go
//go:embed all:frontend/dist
var assets embed.FS
```

确保 `frontend/dist` 目录存在且包含：
- `index.html`
- `assets/` 目录
- `assets/index-*.js`
- `assets/index-*.css`

### 方法 4: 使用生产构建测试

```bash
# 构建生产版本
wails build

# 运行构建的应用
./build/bin/xterm-file-manager.app/Contents/MacOS/xterm-file-manager
```

## 调试步骤

1. **检查浏览器控制台**：
   - 打开应用窗口（如果可能，右键菜单可能有"开发者工具"）
   - 或者在浏览器中打开 `http://localhost:34115` 并查看控制台

2. **查看终端输出**：
   - 检查是否有错误信息
   - 查看 "Serving assets from disk" 的路径是否正确

3. **验证文件存在**：
   ```bash
   ls -la frontend/dist/
   ls -la frontend/dist/assets/
   ```

## 当前状态

✅ 服务器正常运行 (端口 34115)  
✅ 前端已构建 (`frontend/dist` 存在)  
✅ Wails 绑定已配置 (`Bind: []interface{}{app}`)  
⏳ 需要验证应用窗口是否能加载资源

## 下一步

1. 在浏览器中打开 `http://localhost:34115` 测试
2. 如果浏览器正常，重新构建并重启应用
3. 如果浏览器也白屏，检查浏览器控制台错误
