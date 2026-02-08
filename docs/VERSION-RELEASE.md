# 如何设置版本号并编译发版

## 🎯 快速设置版本号

### 方法 1: 编辑 wails.json（推荐）

打开 `wails.json` 文件，修改 `version` 字段：

```json
{
  "$schema": "https://wails.io/schemas/config.v2.json",
  "name": "xterm-file-manager",
  "version": "2.33",    <-- 修改这里
  "outputfilename": "xterm-file-manager",
  ...
}
```

然后运行编译：

```bash
./build-release.sh all
```

输出文件会自动包含版本号：
```
build/releases/
├── xterm-file-manager-v2.33-darwin-arm64.zip
├── xterm-file-manager-v2.33-darwin-amd64.zip
├── xterm-file-manager-v2.33-windows-amd64.exe
└── xterm-file-manager-v2.33-linux-amd64.tar.gz
```

---

## 📝 完整的发版流程

### 1. 更新版本号

编辑 `wails.json`，将 `version` 改为新版本号（如 `2.33`）

### 2. 更新 Changelog

编辑 `README.md`，在 Changelog 部分添加新版本的更新内容：

```markdown
## Changelog

### v2.33 - 新功能 (2026-02-08)

**新增功能:**
- Windows 本地终端支持（使用 ConPTY）
- Linux shell 默认值修复
- 终端会话清理泄漏修复
- ... 其他更新

### v2.32 - 国际化支持 (2026-02-08)
...
```

### 3. 编译所有平台

```bash
./build-release.sh all
```

这会编译：
- macOS Apple Silicon (M1/M2/M3)
- macOS Intel
- Windows 64-bit
- Linux 64-bit

### 4. 测试每个平台

#### 测试 macOS
```bash
cd build/releases
unzip xterm-file-manager-v2.33-darwin-arm64.zip
xattr -cr xterm-file-manager.app
open xterm-file-manager.app
# 测试功能...
```

#### 测试 Windows（如果有 Windows 机器）
```bash
# 在 Windows 上运行
xterm-file-manager-v2.33-windows-amd64.exe
```

#### 测试 Linux（如果有 Linux 机器）
```bash
tar -xzf xterm-file-manager-v2.33-linux-amd64.tar.gz
./xterm-file-manager
```

### 5. 创建 GitHub Release

1. 进入 GitHub 仓库的 Releases 页面
2. 点击 "Draft a new release"
3. 填写信息：
   - **Tag version**: `v2.33`
   - **Release title**: `v2.33 - 新功能描述`
   - **Description**: 复制 README.md 中的 Changelog 内容
4. 上传文件（从 `build/releases/` 目录）：
   - `xterm-file-manager-v2.33-darwin-arm64.zip`
   - `xterm-file-manager-v2.33-darwin-amd64.zip`
   - `xterm-file-manager-v2.33-windows-amd64.exe`
   - `xterm-file-manager-v2.33-linux-amd64.tar.gz`
5. 点击 "Publish release"

---

## 🔄 版本号规范

推荐使用语义化版本号（Semantic Versioning）：

- **主版本号 (Major)**: 重大功能变更或不兼容的 API 修改
  - 例如：`1.0` → `2.0`
  
- **次版本号 (Minor)**: 新增功能，向下兼容
  - 例如：`2.5` → `2.6`
  
- **修订号 (Patch)**: Bug 修复，向下兼容
  - 例如：`2.5.1` → `2.5.2`

当前版本：`2.33`（使用的是 Major.Minor 格式）

---

## ✅ 发版 Checklist

每次发版前检查：

- [ ] 更新 `wails.json` 的 `version` 字段
- [ ] 更新 `README.md` 的 Changelog
- [ ] 运行 `./build-release.sh all` 编译所有平台
- [ ] 测试 macOS 版本
- [ ] 测试 Windows 版本（如有条件）
- [ ] 测试 Linux 版本（如有条件）
- [ ] 检查所有文件大小合理（通常 40-50MB）
- [ ] 上传到 GitHub Releases
- [ ] 添加 Release Notes（描述本次更新）
- [ ] 检查下载链接是否正常工作

---

## 📂 文件目录结构

```
build/releases/
└── v2.33/  (可选：按版本号组织)
    ├── xterm-file-manager-v2.33-darwin-arm64.zip
    ├── xterm-file-manager-v2.33-darwin-amd64.zip
    ├── xterm-file-manager-v2.33-windows-amd64.exe
    └── xterm-file-manager-v2.33-linux-amd64.tar.gz
```

如果想按版本号组织文件，可以手动创建子目录：

```bash
mkdir -p build/releases/v2.33
mv build/releases/xterm-file-manager-v2.33-* build/releases/v2.33/
```

---

## 🎯 示例：发布 v2.33 的完整命令

```bash
# 1. 修改版本号（手动编辑 wails.json，改 version 为 "2.33"）

# 2. 编译所有平台
./build-release.sh all

# 3. 查看生成的文件
ls -lh build/releases/

# 4. 测试 macOS 版本
cd build/releases
unzip xterm-file-manager-v2.33-darwin-arm64.zip
xattr -cr xterm-file-manager.app
open xterm-file-manager.app

# 5. 上传到 GitHub Releases（手动操作）
```

完成！🎉
