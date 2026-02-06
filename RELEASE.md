# Release v0.1.0 - 发布说明

## 编译完成的文件

所有编译好的文件位于 `build/release/` 目录：

1. **macOS Intel (amd64)**: `xterm-file-manager-darwin-amd64.zip`
2. **macOS Apple Silicon (arm64)**: `xterm-file-manager-darwin-arm64.zip`
3. **Windows (amd64)**: `xterm-file-manager-windows-amd64.exe`

**注意**: Linux 版本无法在 macOS 上交叉编译（Wails 限制），需要在 Linux 环境中编译。

## 创建 GitHub Release 的方法

### 方法 1: 使用 GitHub 网页界面

1. 访问: https://github.com/xxddccaa/xterm-file-manager/releases/new
2. 选择标签: `v0.1.0`
3. 标题: `Release v0.1.0`
4. 描述:
   ```
   Release v0.1.0
   
   First release of XTerm File Manager.
   ```
5. 上传文件:
   - `build/release/xterm-file-manager-darwin-amd64.zip`
   - `build/release/xterm-file-manager-darwin-arm64.zip`
   - `build/release/xterm-file-manager-windows-amd64.exe`
6. 点击 "Publish release"

### 方法 2: 使用 GitHub CLI

如果已安装 GitHub CLI (`gh`):

```bash
cd /Users/xd/Documents/xiedong_dev/mac_code/xterm-file-manager

# 创建 Release
gh release create v0.1.0 \
  --title "Release v0.1.0" \
  --notes "Release v0.1.0 - First release of XTerm File Manager." \
  build/release/xterm-file-manager-darwin-amd64.zip \
  build/release/xterm-file-manager-darwin-arm64.zip \
  build/release/xterm-file-manager-windows-amd64.exe
```

### 方法 3: 使用 curl 和 GitHub API

需要 GitHub Personal Access Token (需要 `repo` 权限):

```bash
cd /Users/xd/Documents/xiedong_dev/mac_code/xterm-file-manager

# 设置 token (替换 YOUR_TOKEN)
export GITHUB_TOKEN="your_github_token_here"

# 创建 Release
curl -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github.v3+json" \
  https://api.github.com/repos/xxddccaa/xterm-file-manager/releases \
  -d '{
    "tag_name": "v0.1.0",
    "name": "Release v0.1.0",
    "body": "Release v0.1.0 - First release of XTerm File Manager.",
    "draft": false,
    "prerelease": false
  }'

# 获取 Release ID (从上面的响应中获取)
RELEASE_ID="your_release_id"

# 上传文件
curl -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/zip" \
  --data-binary @build/release/xterm-file-manager-darwin-amd64.zip \
  "https://uploads.github.com/repos/xxddccaa/xterm-file-manager/releases/$RELEASE_ID/assets?name=xterm-file-manager-darwin-amd64.zip"

curl -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/zip" \
  --data-binary @build/release/xterm-file-manager-darwin-arm64.zip \
  "https://uploads.github.com/repos/xxddccaa/xterm-file-manager/releases/$RELEASE_ID/assets?name=xterm-file-manager-darwin-arm64.zip"

curl -X POST \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @build/release/xterm-file-manager-windows-amd64.exe \
  "https://uploads.github.com/repos/xxddccaa/xterm-file-manager/releases/$RELEASE_ID/assets?name=xterm-file-manager-windows-amd64.exe"
```

## 文件清单

- ✅ 代码已推送到 GitHub
- ✅ 标签 v0.1.0 已创建并推送
- ✅ macOS amd64 版本已编译
- ✅ macOS arm64 版本已编译
- ✅ Windows amd64 版本已编译
- ⚠️ Linux amd64 版本需要 Linux 环境编译
- ⏳ GitHub Release 待创建（请使用上述方法之一）
