# 发版流程 (Release Process)

本文档记录了 XTerm File Manager 的标准发版流程。每次代码修改完成后，按照此流程发布新版本。

## 📋 发版前准备

### 1. 确认代码修改完成
- 所有功能已开发并测试完成
- Bug 已修复并验证
- 代码已通过本地测试 (`wails dev`)

### 2. 检查代码质量
```bash
# Go 代码格式化
go fmt ./...

# Go 代码检查
go vet ./...

# 前端代码检查（可选）
cd frontend && npm run lint
```

## 🔍 Step 1: 查看代码变化

查看 git diff 了解本次修改的内容：

```bash
# 查看工作区状态
git status

# 查看未暂存的更改
git diff

# 查看已暂存的更改
git diff --staged

# 查看最近的提交记录（了解提交风格）
git log --oneline -10
```

## 📝 Step 2: 更新文档

根据代码变化更新相关文档：

### 2.1 更新 README.md

在 `README.md` 的 Changelog 部分**顶部**添加新版本更新日志：

```markdown
## Changelog

### vX.XX - [简短标题] (YYYY-MM-DD)

**[分类1]:**
- [更改1描述]
- [更改2描述]

**[分类2]:**
- [更改3描述]

### v2.27 - Security & Performance Improvements (2026-02-07)
...
```

**常用分类：**
- Security Enhancements (安全增强)
- Performance Optimizations (性能优化)
- Bug Fixes (Bug 修复)
- New Features (新功能)
- Breaking Changes (破坏性更改)
- Documentation (文档更新)

### 2.2 更新 docs/工程总结.md

在 `docs/工程总结.md` 的顶部添加详细的版本记录：

```markdown
## 🔥 Latest Update (YYYY-MM-DD)

### Version X.XX - [标题] (YYYY-MM-DD)

[详细的技术说明，包括：]
- 功能描述
- 实现细节
- 文件变更列表
- 关键经验总结
```

### 2.3 检查其他文档

- `AGENTS.md` - 如有新的开发规范或模式，更新此文档
- 其他相关文档（如有）

## 🧹 Step 3: 清理缓存

**重要：每次编译前必须清理缓存**，否则可能打包旧代码：

```bash
# 清理编译产物和 frontend 构建文件和缓存
rm -rf build/bin/*
rm -rf frontend/dist/assets
cd frontend && rm -rf node_modules/.vite .vite
cd ..
```

**注意：**
- `build/bin/*` 可以随便删，只有编译产物
- 不要删除整个 `frontend/dist/` 目录（包含 gitkeep，Go 的 `//go:embed` 依赖它）
- 只删除 `dist/assets` 和 Vite 缓存目录

## 🏗️ Step 4: 编译全平台软件

### 方法 1: 使用自动化脚本（推荐）

使用 `build-release.sh` 脚本一键编译所有平台并打包到 `build/releases/` 目录：

```bash
# 编译所有平台（推荐）
./build-release.sh all
```

**脚本自动完成：**
- ✅ 清理缓存（Step 3 的所有操作）
- ✅ 编译所有平台（darwin/amd64, darwin/arm64, windows/amd64）
- ✅ 自动打包：
  - macOS: 打包成 `.zip`（包含 .app）
  - Windows: 复制 `.exe` 文件
- ✅ 输出文件自动包含版本号（从 `wails.json` 读取）

**输出位置：**
```
build/releases/
├── xterm-file-manager-v2.33-darwin-arm64.zip    (macOS Apple Silicon)
├── xterm-file-manager-v2.33-darwin-amd64.zip    (macOS Intel)
└── xterm-file-manager-v2.33-windows-amd64.exe   (Windows)
```

**注意：**
- Linux 在 macOS 上无法交叉编译，脚本会跳过（这是正常的）
- 如需 Linux 版本，需要在 Linux 环境下运行 `wails build -platform linux/amd64 -clean`

### 方法 2: 手动编译（开发测试用）

按顺序编译各平台版本：

#### 4.1 编译 macOS Intel (darwin/amd64)

```bash
wails build -platform darwin/amd64 -clean
```

#### 4.2 编译 macOS Apple Silicon (darwin/arm64)

```bash
wails build -platform darwin/arm64 -clean
```

#### 4.3 编译 Windows (windows/amd64)

```bash
wails build -platform windows/amd64 -clean
```

#### 4.4 编译 Linux (linux/amd64)

**注意：在 macOS 上无法交叉编译 Linux。** 需要在 Linux 环境下编译。

```bash
# 在 Linux 环境下执行
wails build -platform linux/amd64 -clean
```

如果没有 Linux 环境，可以跳过此步骤。

#### 4.5 验证编译结果

```bash
# 检查编译输出
ls -lh build/bin/

# 应该看到：
# xterm-file-manager.app (macOS)
# xterm-file-manager.exe (Windows)
```

**手动打包（如果使用方法 2）：**

```bash
# macOS 打包成 zip
cd build/bin
zip -r ../../build/releases/xterm-file-manager-v2.33-darwin-arm64.zip xterm-file-manager.app

# Windows 复制 exe
cp build/bin/xterm-file-manager.exe build/releases/xterm-file-manager-v2.33-windows-amd64.exe
```

## 🏷️ Step 5: 创建版本 Tag

### 5.1 查看现有 Tag

```bash
# 查看所有 tag
git tag --list | sort -V

# 查看最近的 tag
git tag --list | sort -V | tail -5
```

### 5.2 确定新版本号

根据变更类型确定版本号：
- **大版本号 (X.0.0)**: 架构重构、破坏性变更
- **小版本号 (2.X.0)**: 新功能、增强
- **补丁号 (2.27.X)**: Bug 修复、小改动

当前项目使用 `vX.XX` 格式（如 v2.27）。

### 5.3 提交代码

```bash
# 暂存所有更改
git add -A

# 查看暂存状态
git status

# 创建提交（使用详细的提交信息）
git commit -m "vX.XX: [简短标题]

[分类1]:
- [更改1]
- [更改2]

[分类2]:
- [更改3]

Documentation:
- Updated README.md and docs/工程总结.md with vX.XX changelog"
```

**提交信息模板：**
```
vX.XX: [一行简短标题]

[具体分类1]:
- [具体改动1]
- [具体改动2]

[具体分类2]:
- [具体改动3]

Documentation:
- [文档更新说明]
```

### 5.4 创建 Git Tag

```bash
# 创建 tag
git tag vX.XX

# 验证 tag 已创建
git tag --list | sort -V | tail -5
```

## 🚀 Step 6: Push 到远程

```bash
# Push 代码
git push

# Push tag
git push --tags
```

验证：
- 访问 GitHub 仓库，确认代码和 tag 已推送
- 查看 Releases 页面，确认新 tag 出现

## 📦 Step 7: 创建 GitHub Release (可选)

### 方法 1: 使用 build-release.sh 的输出文件

如果使用了 `build-release.sh all`，发版文件已经在 `build/releases/` 目录中：

```bash
ls -lh build/releases/
# xterm-file-manager-v2.33-darwin-arm64.zip    (4.4M)
# xterm-file-manager-v2.33-darwin-amd64.zip    (4.7M)
# xterm-file-manager-v2.33-windows-amd64.exe   (13M)
```

### 方法 2: 手动准备文件

如果手动编译，需要先打包：

```bash
# 打包 macOS 应用
cd build/bin
zip -r ../releases/xterm-file-manager-v2.33-darwin-arm64.zip xterm-file-manager.app

# 复制 Windows exe
cp xterm-file-manager.exe ../releases/xterm-file-manager-v2.33-windows-amd64.exe
```

### GitHub Release 步骤

1. 访问 GitHub 仓库的 Releases 页面
2. 点击 "Draft a new release"
3. 选择刚创建的 tag (v2.33)
4. 填写 Release 标题和描述（从 README.md 复制）
5. 上传编译好的二进制文件（从 `build/releases/` 目录）：
   - `xterm-file-manager-v2.33-darwin-amd64.zip`
   - `xterm-file-manager-v2.33-darwin-arm64.zip`
   - `xterm-file-manager-v2.33-windows-amd64.exe`
6. 点击 "Publish release"

## ✅ 发版完成检查清单

- [x] 代码已提交并推送到 main 分支
- [x] README.md 已更新 Changelog
- [x] docs/工程总结.md 已添加详细记录
- [x] wails.json 版本号已更新
- [x] 已清理缓存并重新编译
- [x] 已编译 darwin/amd64 ✓
- [x] 已编译 darwin/arm64 ✓
- [x] 已编译 windows/amd64 ✓
- [x] 已使用 build-release.sh 打包到 build/releases/
- [x] 已创建版本 tag (v2.33)
- [x] 已 push 代码和 tag 到远程
- [ ] (可选) 已创建 GitHub Release 并上传文件

**本次发版 (v2.33) 已完成！**

发版文件位置：`build/releases/`
- `xterm-file-manager-v2.33-darwin-arm64.zip` (4.4M)
- `xterm-file-manager-v2.33-darwin-amd64.zip` (4.7M)
- `xterm-file-manager-v2.33-windows-amd64.exe` (13M)

## 🔧 常见问题

### Q1: 编译后运行出现白屏/黑屏

**原因：** 可能是缓存未清理干净

**解决：**
```bash
# 彻底清理缓存
rm -rf build/bin/* frontend/dist/assets frontend/node_modules/.vite frontend/.vite
cd frontend && npm install && cd ..
wails build -platform darwin/arm64 -clean
```

### Q2: macOS 提示"应用已损坏"

**原因：** Gatekeeper 安全机制

**解决：** 用户需要运行以下命令：
```bash
xattr -cr /path/to/xterm-file-manager.app
```

### Q3: 忘记清理缓存，已经编译完成

**解决：**
```bash
# 重新清理并编译
rm -rf build/bin/* frontend/dist/assets frontend/node_modules/.vite frontend/.vite
wails build -platform darwin/amd64 -clean
wails build -platform darwin/arm64 -clean
wails build -platform windows/amd64 -clean
```

### Q4: 需要回滚版本

**解决：**
```bash
# 查看提交历史
git log --oneline

# 回滚到指定提交
git reset --hard <commit-hash>

# 强制推送（谨慎使用）
git push --force

# 删除错误的 tag
git tag -d vX.XX
git push origin :refs/tags/vX.XX
```

## 📚 参考文档

- [AGENTS.md](AGENTS.md) - AI 开发者指南
- [README.md](README.md) - 项目介绍和安装说明
- [docs/工程总结.md](docs/工程总结.md) - 详细的版本更新记录
- [Wails 官方文档](https://wails.io/docs/introduction)

## 🤖 AI 使用说明

**给 AI 的指令：**

```
按照 RELEASE_PROCESS.md 的流程发布新版本。

当前已完成的修改：
- [列出主要修改]

请执行：
1. 查看 git diff 了解代码变化
2. 更新 README.md 和 docs/工程总结.md
3. 清理缓存
4. 编译全平台（darwin/amd64, darwin/arm64, windows/amd64）
5. 查看现有 tag，创建新版本 tag（版本号递增）
6. Push 代码和 tag 到远程
```

**AI 执行示例：**

```markdown
我会按照发版流程执行以下步骤：
1. 查看代码变化 (git diff, git status)
2. 更新文档 (README.md, docs/工程总结.md)
3. 清理缓存
4. 编译全平台
5. 创建 tag
6. Push 到远程

正在执行...
```

## 📝 发版日志模板

**提交信息模板：**
```
vX.XX: [简短标题]

Security Enhancements / New Features / Bug Fixes / Performance:
- [改动1]
- [改动2]

Documentation:
- Updated README.md and docs/工程总结.md
```

**README.md Changelog 模板：**
```markdown
### vX.XX - [标题] (YYYY-MM-DD)

**[分类]:**
- [描述1]
- [描述2]
```

**docs/工程总结.md 模板：**
```markdown
## 🔥 Latest Update (YYYY-MM-DD)

### Version X.XX - [标题] (YYYY-MM-DD)

**[分类]:**
- **[子功能]**: [详细说明]
  - [技术细节1]
  - [技术细节2]

**Files Changed:**
- **Backend**: [文件列表]
- **Frontend**: [文件列表]
- **Documentation**: [文件列表]

**Key Lessons:**
- [经验总结1]
- [经验总结2]
```

---

**最后更新：** 2026-02-08
**维护者：** XTerm File Manager Team
