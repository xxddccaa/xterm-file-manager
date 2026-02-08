# 发版编译指南

## 🚀 快速开始

### 一键编译发版（推荐）

```bash
# 编译当前平台（macOS Apple Silicon）
./build-release.sh

# 编译所有平台
./build-release.sh all
```

发版文件会自动生成到：`build/releases/`

---

## 📋 详细说明

### 1. 支持的平台

| 平台 | 命令 | 输出文件 |
|------|------|----------|
| macOS Apple Silicon (M1/M2/M3) | `./build-release.sh darwin-arm64` | `xterm-file-manager-v{版本}-darwin-arm64.zip` |
| macOS Intel | `./build-release.sh darwin-amd64` | `xterm-file-manager-v{版本}-darwin-amd64.zip` |
| Windows 64位 | `./build-release.sh windows` | `xterm-file-manager-v{版本}-windows-amd64.exe` |
| Linux 64位 | `./build-release.sh linux` | `xterm-file-manager-v{版本}-linux-amd64.tar.gz` |
| **所有平台** | `./build-release.sh all` | 以上所有文件 |

### 2. 编译流程

脚本会自动完成以下步骤：

1. ✅ **清理缓存**
   - 清理 `build/bin/*`（旧的编译产物）
   - 清理 `frontend/dist/assets`（旧的前端打包文件）
   - 清理 Vite 缓存（`.vite` 和 `node_modules/.vite`）

2. ✅ **安装依赖**
   - 如果 `node_modules` 不存在，自动运行 `npm install`

3. ✅ **编译应用**
   - 使用 `wails build -platform {平台} -clean` 编译
   - 自动处理 Go 和前端代码

4. ✅ **打包发版**
   - macOS: 打包成 `.zip`（包含 `.app`）
   - Windows: 复制 `.exe` 文件
   - Linux: 打包成 `.tar.gz`

5. ✅ **显示结果**
   - 显示生成的文件路径
   - 显示文件大小
   - 提供快速测试命令

### 3. 使用示例

#### 编译 macOS Apple Silicon 版本

```bash
./build-release.sh darwin-arm64
```

输出：
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  XTerm File Manager - Release Build
  Version: 2.32
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[1/5] 🧹 清理缓存和旧文件...
✓ 缓存清理完成

[2/5] ✓ 前端依赖已存在，跳过安装

[3/5] 🔨 编译 macOS (Apple Silicon)...
✓ macOS (Apple Silicon) 编译成功

[4/5] 📦 打包到 releases...
✓ 已打包: xterm-file-manager-v2.32-darwin-arm64.zip
  大小: 45M

[5/5] ✅ 完成！

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  发版文件已生成到:
  /Users/xd/Documents/xiedong_dev/mac_code/xterm-file-manager/build/releases
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### 编译所有平台

```bash
./build-release.sh all
```

将会依次编译：
- macOS Apple Silicon
- macOS Intel
- Windows
- Linux

所有文件都在 `build/releases/` 目录中。

### 4. 测试编译结果

#### macOS

```bash
# 进入发版目录
cd build/releases

# 解压
unzip xterm-file-manager-v2.32-darwin-arm64.zip

# 移除 macOS 隔离属性（首次需要）
xattr -cr xterm-file-manager.app

# 运行
open xterm-file-manager.app
```

#### Windows

```bash
# 直接运行
build/releases/xterm-file-manager-v2.32-windows-amd64.exe
```

#### Linux

```bash
# 解压
cd build/releases
tar -xzf xterm-file-manager-v2.32-linux-amd64.tar.gz

# 运行
./xterm-file-manager
```

---

## ⚠️ 常见问题

### Q1: 编译失败怎么办？

**A:** 先完全清理缓存再试：

```bash
# 清理所有缓存
rm -rf build/bin/*
rm -rf frontend/dist/assets
cd frontend
rm -rf node_modules/.vite .vite node_modules
npm install
cd ..

# 重新编译
./build-release.sh
```

### Q2: macOS 提示"应用已损坏"

**A:** 运行以下命令移除隔离属性（一次性操作）：

```bash
xattr -cr xterm-file-manager.app
```

### Q3: 编译的文件在哪里？

**A:** 所有发版文件都在 `build/releases/` 目录：

```bash
ls -lh build/releases/
```

### Q4: 如何修改版本号？

**A:** 编辑 `wails.json` 文件中的 `version` 字段：

```json
{
  "version": "2.33",
  ...
}
```

脚本会自动读取版本号并应用到文件名。

### Q5: 我只想快速测试，不需要打包

**A:** 使用开发模式：

```bash
# 开发模式（支持热重载）
wails dev
```

或者手动编译（不打包）：

```bash
rm -rf build/bin/* frontend/dist/assets
cd frontend && rm -rf .vite node_modules/.vite && cd ..
wails build -platform darwin/arm64 -clean
open build/bin/xterm-file-manager.app
```

---

## 🎯 发版 Checklist

发布新版本前的检查清单：

- [ ] 更新版本号（`wails.json` 中的 `version`）
- [ ] 更新 `README.md` 的 Changelog
- [ ] 运行 `./build-release.sh all` 编译所有平台
- [ ] 测试每个平台的可执行文件
- [ ] 上传到 GitHub Releases
- [ ] 更新 Release Notes

---

## 📚 相关文档

- [开发指南](README.md#development)
- [项目结构](README.md#project-structure)
- [AGENTS.md](AGENTS.md) - 开发者 AI 协作指南
