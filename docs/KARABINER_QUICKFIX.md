# 🚀 快速开始 - 修复 Karabiner 键盘问题

## 📋 问题描述
Karabiner-Elements 拦截了键盘事件，导致 Ctrl+C、Ctrl+D、F2 等快捷键无法使用。

---

## ⚡ 快速解决方案（3 步）

### 第 1 步：获取应用的 Bundle ID

打开终端运行：

```bash
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" \
  /Users/xd/Documents/xiedong_dev/mac_code/xterm-file-manager/build/bin/xterm-file-manager.app/Contents/Info.plist
```

记录输出的 ID（例如：`com.wails.xterm-file-manager`）

### 第 2 步：配置 Karabiner-Elements

**选项 A - 临时测试（最简单）**：

1. 点击菜单栏的 Karabiner 图标
2. 选择 "Quit Karabiner-Elements"
3. 测试应用的快捷键
4. 如果工作了，继续第 3 步

**选项 B - 添加例外规则（推荐）**：

```bash
# 打开 Karabiner 配置文件夹
open ~/.config/karabiner/
```

编辑 `karabiner.json`，在 `profiles` → `complex_modifications` → `rules` 中添加：

```json
{
  "description": "Allow all shortcuts for XTerm File Manager",
  "manipulators": [
    {
      "type": "basic",
      "conditions": [
        {
          "type": "frontmost_application_if",
          "bundle_identifiers": [
            "^com\\.wails\\.xterm-file-manager$"
          ]
        }
      ],
      "from": {
        "any": "key_code"
      },
      "to": [
        {
          "any": "key_code"
        }
      ]
    }
  ]
}
```

**注意**：将 `com.wails.xterm-file-manager` 替换为第 1 步获取的实际 Bundle ID。

### 第 3 步：运行测试脚本

```bash
cd /Users/xd/Documents/xiedong_dev/mac_code/xterm-file-manager
./test-keyboard.sh
```

这个脚本会：
- ✅ 自动检测 Bundle ID
- ✅ 检测 Karabiner 状态
- ✅ 启动应用
- ✅ 收集键盘事件日志
- ✅ 显示诊断结果

---

## 📊 查看日志

### 实时查看日志

```bash
tail -f /tmp/xterm-file-manager-debug.log
```

### 查看 wails dev 输出

```bash
cat /Users/xd/.cursor/projects/Users-xd-Documents-xiedong-dev-mac-code-xterm-file-manager/terminals/11.txt
```

---

## 🔍 期望看到的日志

如果快捷键工作正常，日志应该显示：

```
[2026-02-06T...] 🎯 [FileManager] Installing keyboard listener
[2026-02-06T...] 🔑 [FileManager] KeyDown: {"key":"F2",...}
[2026-02-06T...] ✅ [FileManager] F2 pressed with selected file: test.txt
[2026-02-06T...] 📝 [FileManager] Opening rename dialog for: test.txt
```

```
[2026-02-06T...] 🖥️ [Terminal] KeyEvent: {"key":"c","ctrl":true,...}
[2026-02-06T...] ✅ [Terminal] Ctrl+C detected, selection: YES
[2026-02-06T...] 📋 [Terminal] Copying to clipboard
```

---

## ❌ 如果日志为空

说明键盘事件被 Karabiner 完全拦截了。

**立即解决**：

1. **临时方案** - 退出 Karabiner：
   ```bash
   killall karabiner_console_user_server
   ```

2. **永久方案** - 配置例外规则（见上面第 2 步）

---

## 📁 文件说明

- `test-keyboard.sh` - 自动化测试脚本（运行这个！）
- `KARABINER_SETUP.md` - 详细的 Karabiner 配置指南
- `karabiner-config.json` - Karabiner 配置模板
- `/tmp/xterm-file-manager-debug.log` - 应用日志文件

---

## 🆘 需要帮助？

运行测试脚本后，把以下内容发给我：

1. **Bundle ID**（第 1 步的输出）
2. **日志内容**：
   ```bash
   cat /tmp/xterm-file-manager-debug.log
   ```
3. **Karabiner 状态**：
   ```bash
   ps aux | grep karabiner
   ```

---

## 🎯 应用现在正在运行

`wails dev` 已经在后台启动了：
- 应用会自动打开
- 代码修改会热重载
- 日志会写入 `/tmp/xterm-file-manager-debug.log`

**现在就测试**：
1. 选择一个文件
2. 按 F2
3. 查看是否弹出重命名对话框
4. 查看日志：`tail -f /tmp/xterm-file-manager-debug.log`

---

## ✨ 如果一切正常

您应该看到：
- ✅ F2 弹出重命名对话框
- ✅ Ctrl+C 可以复制或中断
- ✅ Ctrl+D 可以发送 EOF
- ✅ Ctrl+V 可以粘贴
- ✅ 日志文件有大量键盘事件记录

如果还有问题，把日志发给我！🚀
