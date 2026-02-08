# 🚀 快速编译发版

## 📌 设置版本号

编辑 `wails.json`，修改 `version` 字段：

```json
{
  "version": "2.33",  <-- 改这里
  ...
}
```

## 一条命令搞定

```bash
# 编译当前平台（默认 macOS Apple Silicon）
./build-release.sh

# 编译所有平台
./build-release.sh all

# 编译特定平台
./build-release.sh darwin-arm64   # macOS M1/M2/M3
./build-release.sh darwin-amd64   # macOS Intel
./build-release.sh windows        # Windows
./build-release.sh linux          # Linux
```

## 输出位置

```
build/releases/
├── xterm-file-manager-v{版本}-darwin-arm64.zip    (macOS Apple Silicon)
├── xterm-file-manager-v{版本}-darwin-amd64.zip    (macOS Intel)
├── xterm-file-manager-v{版本}-windows-amd64.exe   (Windows)
└── xterm-file-manager-v{版本}-linux-amd64.tar.gz  (Linux)
```

## 测试运行

### macOS
```bash
cd build/releases
unzip xterm-file-manager-v*-darwin-arm64.zip
xattr -cr xterm-file-manager.app  # 移除隔离（首次需要）
open xterm-file-manager.app
```

### Windows
```bash
build/releases/xterm-file-manager-v*-windows-amd64.exe
```

### Linux
```bash
cd build/releases
tar -xzf xterm-file-manager-v*-linux-amd64.tar.gz
./xterm-file-manager
```

---

## 详细文档

- 📚 完整指南：[docs/BUILD-RELEASE.md](docs/BUILD-RELEASE.md)
- 🔖 版本号设置：[docs/VERSION-RELEASE.md](docs/VERSION-RELEASE.md)
- 📝 发版流程：[docs/VERSION-RELEASE.md](docs/VERSION-RELEASE.md)
