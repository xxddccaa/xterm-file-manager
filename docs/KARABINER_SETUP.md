# Karabiner-Elements 配置指南

## 问题诊断

您遇到的问题是 Karabiner-Elements 在系统层面拦截了键盘事件，导致快捷键无法传递到应用程序。

## 解决方案 1：查找应用的 Bundle Identifier

首先，我们需要找到应用的实际 Bundle Identifier。

### 步骤 1：获取 Bundle Identifier

打开终端，运行以下命令：

```bash
# 方法 1：直接查看应用的 Info.plist
/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" /Users/xd/Documents/xiedong_dev/mac_code/xterm-file-manager/build/bin/xterm-file-manager.app/Contents/Info.plist

# 方法 2：使用 osascript
osascript -e 'id of app "xterm-file-manager"'

# 方法 3：启动应用后查询
# 1. 启动 xterm-file-manager 应用
# 2. 在终端运行：
lsappinfo info -only bundleid $(lsappinfo find LSDisplayName=xterm-file-manager)
```

### 步骤 2：记录 Bundle Identifier

记录输出的 Bundle Identifier，例如：
- 可能是 `com.wails.xterm-file-manager`
- 或者 `com.yourname.xterm-file-manager`
- 或者其他格式

---

## 解决方案 2：配置 Karabiner-Elements

### 方法 A：使用图形界面（推荐新手）

1. **打开 Karabiner-Elements**
   - 在应用程序文件夹找到 Karabiner-Elements
   - 或者点击菜单栏的 Karabiner 图标

2. **进入 Devices 标签**
   - 确保您的键盘已启用

3. **进入 Complex Modifications 标签**
   - 点击 "Add rule" 按钮
   - 点击 "Import more rules from the Internet"

4. **或者手动添加规则**：
   - 点击 "Add rule"
   - 点击左下角的齿轮图标（设置）
   - 选择 "Open config folder" (~/.config/karabiner)

### 方法 B：手动编辑配置文件（推荐高级用户）

#### 步骤 1：备份现有配置

```bash
cp ~/.config/karabiner/karabiner.json ~/.config/karabiner/karabiner.json.backup
```

#### 步骤 2：获取当前配置

```bash
# 查看配置文件
cat ~/.config/karabiner/karabiner.json | jq .
```

#### 步骤 3：添加规则

编辑配置文件：

```bash
open -a "Visual Studio Code" ~/.config/karabiner/karabiner.json
# 或者
open -a "TextEdit" ~/.config/karabiner/karabiner.json
```

在 `profiles` → `complex_modifications` → `rules` 数组中添加以下规则：

**注意**：将 `BUNDLE_ID_HERE` 替换为您在步骤 1 中获取的实际 Bundle Identifier

```json
{
  "description": "Pass through all shortcuts for XTerm File Manager",
  "manipulators": [
    {
      "type": "basic",
      "conditions": [
        {
          "type": "frontmost_application_if",
          "bundle_identifiers": [
            "^BUNDLE_ID_HERE$"
          ]
        }
      ],
      "from": {
        "key_code": "c",
        "modifiers": {
          "mandatory": ["control"]
        }
      },
      "to": [
        {
          "key_code": "c",
          "modifiers": ["control"]
        }
      ]
    },
    {
      "type": "basic",
      "conditions": [
        {
          "type": "frontmost_application_if",
          "bundle_identifiers": [
            "^BUNDLE_ID_HERE$"
          ]
        }
      ],
      "from": {
        "key_code": "d",
        "modifiers": {
          "mandatory": ["control"]
        }
      },
      "to": [
        {
          "key_code": "d",
          "modifiers": ["control"]
        }
      ]
    },
    {
      "type": "basic",
      "conditions": [
        {
          "type": "frontmost_application_if",
          "bundle_identifiers": [
            "^BUNDLE_ID_HERE$"
          ]
        }
      ],
      "from": {
        "key_code": "v",
        "modifiers": {
          "mandatory": ["control"]
        }
      },
      "to": [
        {
          "key_code": "v",
          "modifiers": ["control"]
        }
      ]
    },
    {
      "type": "basic",
      "conditions": [
        {
          "type": "frontmost_application_if",
          "bundle_identifiers": [
            "^BUNDLE_ID_HERE$"
          ]
        }
      ],
      "from": {
        "key_code": "f2"
      },
      "to": [
        {
          "key_code": "f2"
        }
      ]
    }
  ]
}
```

#### 步骤 4：保存并重启 Karabiner-Elements

```bash
# 重启 Karabiner-Elements
killall karabiner_console_user_server
# Karabiner 会自动重新启动
```

---

## 解决方案 3：临时禁用 Karabiner（用于测试）

如果配置复杂，可以先临时禁用 Karabiner 测试应用：

1. **打开 Karabiner-Elements**
2. **点击菜单栏的 Karabiner 图标**
3. **选择 "Quit Karabiner-Elements"**
4. **测试应用的快捷键**
5. **如果工作了，说明确实是 Karabiner 的问题**
6. **重新启动 Karabiner 并按照上面的步骤配置**

---

## 解决方案 4：使用 Karabiner 的应用排除列表

另一种简单的方法是将应用添加到排除列表：

1. **打开 Karabiner-Elements**
2. **进入 "Virtual Keyboard" 标签**
3. **找到 "Disable the virtual keyboard for the following applications"**
4. **点击 "Add item"**
5. **输入 Bundle Identifier**（从步骤 1 获取）
6. **保存**

---

## 验证配置

配置完成后，查看日志文件验证：

```bash
# 清空日志
rm -f /tmp/xterm-file-manager-debug.log

# 启动应用
open /Users/xd/Documents/xiedong_dev/mac_code/xterm-file-manager/build/bin/xterm-file-manager.app

# 等待几秒，然后操作应用（按 F2、Ctrl+C 等）

# 查看日志
tail -f /tmp/xterm-file-manager-debug.log
```

**期望看到的日志**：
```
[2026-02-06T...] 🎯 [FileManager] Installing keyboard listener
[2026-02-06T...] 🔑 [FileManager] KeyDown: {"key":"F2","code":"F2",...}
[2026-02-06T...] ✅ [FileManager] F2 pressed with selected file: ...
```

**如果日志为空**：
- 说明键盘事件仍被拦截
- 检查 Bundle Identifier 是否正确
- 尝试使用通配符：`"^com\\.wails\\..*$"`
- 或者临时完全禁用 Karabiner 测试

---

## 常见的 Bundle Identifier 格式

Wails 应用的 Bundle Identifier 可能是：

1. `com.wails.xterm-file-manager`
2. `com.yourname.xterm-file-manager`
3. `xterm-file-manager` (简化版)
4. 在 `wails.json` 中配置的自定义 ID

查看项目的 `wails.json` 文件：

```bash
cat /Users/xd/Documents/xiedong_dev/mac_code/xterm-file-manager/wails.json | grep -A 5 "info"
```

---

## 如果仍然不工作

如果以上方法都不工作，可以：

1. **使用 Karabiner 的日志查看器**
   ```bash
   tail -f ~/.config/karabiner/log/console_user_server.log
   ```
   查看是否有相关的错误信息

2. **使用 EventViewer**
   - Karabiner-Elements 自带 EventViewer
   - 可以实时查看键盘事件是否被捕获

3. **联系我并提供**：
   - Bundle Identifier
   - Karabiner 配置文件
   - 应用日志 (`/tmp/xterm-file-manager-debug.log`)
   - Karabiner 日志

---

## 快速测试脚本

创建一个测试脚本：

```bash
#!/bin/bash
# 保存为 test-karabiner.sh

echo "=== XTerm File Manager Karabiner Test ==="
echo ""

echo "1. Getting Bundle Identifier..."
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" /Users/xd/Documents/xiedong_dev/mac_code/xterm-file-manager/build/bin/xterm-file-manager.app/Contents/Info.plist 2>/dev/null)
if [ -z "$BUNDLE_ID" ]; then
    echo "   ❌ Could not find Bundle Identifier"
    echo "   App might not be built yet. Run: wails build"
    exit 1
else
    echo "   ✅ Bundle ID: $BUNDLE_ID"
fi

echo ""
echo "2. Clearing debug log..."
rm -f /tmp/xterm-file-manager-debug.log
echo "   ✅ Log cleared"

echo ""
echo "3. Opening application..."
open /Users/xd/Documents/xiedong_dev/mac_code/xterm-file-manager/build/bin/xterm-file-manager.app
echo "   ✅ App launched"

echo ""
echo "4. Waiting 3 seconds for app to start..."
sleep 3

echo ""
echo "5. Instructions:"
echo "   - Click on a file in the app"
echo "   - Press F2 to rename"
echo "   - Press Ctrl+C in terminal"
echo "   - Press Ctrl+D in terminal"
echo ""
echo "6. Checking log in 10 seconds..."
sleep 10

echo ""
echo "=== Debug Log Contents ==="
if [ -f /tmp/xterm-file-manager-debug.log ]; then
    cat /tmp/xterm-file-manager-debug.log
    echo ""
    echo "✅ Log file exists and shown above"
else
    echo "❌ No log file found - keyboard events not reaching app!"
    echo ""
    echo "This means Karabiner is blocking the events."
    echo "Add this Bundle ID to Karabiner config:"
    echo "   $BUNDLE_ID"
fi

echo ""
echo "=== Test Complete ==="
```

运行测试：

```bash
chmod +x test-karabiner.sh
./test-karabiner.sh
```
