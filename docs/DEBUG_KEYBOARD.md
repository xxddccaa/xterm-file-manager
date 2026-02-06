# 键盘快捷键调试指南

## 问题描述
用户反馈：只有 Ctrl+V 可以粘贴，其他快捷键（Ctrl+C、Ctrl+D、F2）都无法使用（macOS）。

## 调试步骤

### 1. 打开开发者工具

启动应用后，按以下快捷键打开开发者控制台：

```
Cmd + Option + I
```

或者在应用菜单中选择：`View` → `Toggle Developer Tools`

### 2. 打开 Console 标签

在开发者工具中，点击 **Console** 标签页。

### 3. 测试快捷键并查看日志

#### 测试 F2 重命名（在文件管理器中）

1. **在 Remote Files 或 Local Files 面板中点击选中一个文件**
   - 确保文件高亮显示
2. **按 F2 键**
   - macOS 可能需要按 **Fn + F2**
   - 或系统设置开启“将 F1、F2 等键用作标准功能键”
   - 已加入备用快捷键：**Cmd + R**（macOS）
3. **查看控制台输出**：

**期望看到的日志**：
```
🔑 FileManager KeyDown: {key: "F2", code: "F2", ctrl: false, meta: false, ...}
✅ F2 pressed with selected file: [文件名]
📝 Opening rename dialog for: [文件名]
```

**如果没有看到日志**：
- 说明 F2 键被拦截或没有触发
- 可能是键盘映射软件问题

#### 测试 Ctrl+C（在终端中）

1. **点击终端面板内部**，确保焦点在终端上
2. **在终端中选中一些文本**（用鼠标拖动）
3. **按 Ctrl+C**
   - 复制也支持 **Cmd + C（macOS）**
4. **查看控制台输出**：

**期望看到的日志**：
```
🖥️ Terminal KeyEvent: {key: "c", code: "KeyC", ctrl: true, meta: false, selection: "has selection"}
✅ Ctrl+C detected, selection: YES
📋 Copying to clipboard
```

**如果没有选中文本，按 Ctrl+C**：
```
🖥️ Terminal KeyEvent: {key: "c", code: "KeyC", ctrl: true, meta: false, selection: "no selection"}
✅ Ctrl+C detected, selection: NO
⚠️ Sending Ctrl+C interrupt to terminal
```

#### 测试 Ctrl+D（在终端中）

1. **在终端中输入命令**：`cat`（不带参数）
2. **按 Enter**（cat 会等待输入）
3. **按 Ctrl+D**
4. **查看控制台输出**：

**期望看到的日志**：
```
🖥️ Terminal KeyEvent: {key: "d", code: "KeyD", ctrl: true, meta: false, ...}
✅ Ctrl+D passing through to terminal
```

#### 测试 Ctrl+V（粘贴）

1. **复制一些文本到剪贴板**
2. **点击终端面板**
3. **按 Ctrl+V**
   - macOS 推荐 **Cmd + V**
4. **查看控制台输出**：

**期望看到的日志**：
```
🖥️ Terminal KeyEvent: {key: "v", code: "KeyV", ctrl: true, meta: false, ...}
✅ Paste shortcut detected (Cmd+V or Ctrl+V)
```

---

## 诊断结果分析

### 情况 1：控制台没有任何日志输出

**原因**：键盘事件完全被拦截，没有到达应用程序

**可能的问题**：
- 键盘映射软件（如 Karabiner-Elements）在系统层面拦截了按键
- 其他应用程序占用了快捷键

**解决方案**：
1. 检查键盘映射软件设置
2. 暂时关闭键盘映射软件测试
3. 添加 xterm-file-manager 到例外列表

### 情况 2：有 Terminal KeyEvent 日志，但没有具体操作日志

**示例**：
```
🖥️ Terminal KeyEvent: {key: "c", code: "KeyC", ctrl: true, ...}
// 但没有 "✅ Ctrl+C detected" 这一行
```

**原因**：事件被触发了，但条件判断没有匹配

**可能的问题**：
- `event.key` 的值不是预期的 "c"、"d"、"v"
- 可能有额外的修饰键（meta、alt、shift）

**解决方案**：
- 记录日志中的 `key` 和 `code` 值
- 检查是否有意外的修饰键状态

### 情况 3：有 FileManager KeyDown 日志，但没有 F2 相关日志

**示例**：
```
🔑 FileManager KeyDown: {key: "F2", code: "F2", ...}
// 但没有 "✅ F2 pressed" 这一行
```

**原因**：F2 被触发了，但没有选中文件

**解决方案**：
- 确保先**单击**文件使其高亮
- 然后再按 F2

### 情况 4：完全没有 FileManager KeyDown 日志

**原因**：焦点不在文档上，或者事件在到达监听器之前被阻止

**解决方案**：
- 点击文件管理器面板
- 确保不是在输入框或其他元素上
- 检查是否有其他全局快捷键冲突

---

## 临时解决方案

在问题解决之前，您可以使用以下替代方案：

### 复制粘贴
- **复制**：使用 **Cmd+C**（macOS 原生，更可靠）
- **粘贴**：使用 **Cmd+V** 或**右键点击终端**

### 重命名
- **右键点击文件** → 选择 **"Rename"**
- macOS 可用 **Cmd + R** 作为备用快捷键
- 这样就不依赖 F2 键

### 终端中断
- Ctrl+C 应该能工作（发送 SIGINT）
- 如果不行，可以关闭整个终端会话

---

## 提供反馈信息

如果快捷键仍然不工作，请提供以下信息：

1. **控制台日志截图**：
   - 按下快捷键时的所有日志输出
   
2. **键盘映射软件**：
   - 使用的软件名称和版本
   - 相关配置截图
   
3. **具体操作步骤**：
   - 哪个快捷键不工作
   - 在哪个面板（终端、Remote Files、Local Files）
   - 是否有选中文件或文本

4. **日志内容**：
   复制控制台中的日志，包括：
   ```
   🔑 或 🖥️ 开头的日志
   ```

---

## 技术说明

### 键盘事件处理机制

#### Terminal 组件（Ctrl+C、Ctrl+D、Ctrl+V）
- 使用 xterm.js 的 `attachCustomKeyEventHandler()`
- 只处理 `keydown` 事件类型
- 只在终端面板有焦点时生效
- **重要**：必须点击终端内部才能触发
- Ctrl+C / Ctrl+D 会显式写入 `\x03` / `\x04` 到终端（避免系统拦截导致无效）

#### FileManager 组件（F2）
- 使用 `document.addEventListener('keydown', handler, true)`
- 使用 capture phase（第三个参数 true）
- 全局监听，但需要有选中文件（`selectedFile` 不为空）
- **条件**：必须先单击选中文件
- macOS 备用快捷键：**Cmd + R**

### 为什么 Ctrl+V 可能工作而其他不工作？

可能的原因：
1. **浏览器/WebView 默认行为**：Ctrl+V 有浏览器内置处理
2. **键盘映射**：映射软件可能特殊处理了 Ctrl+V
3. **事件传播**：Ctrl+V 可能在不同的事件处理阶段被捕获

---

## 开发模式调试

如果需要更详细的调试，可以使用开发模式：

```bash
cd /Users/xd/Documents/xiedong_dev/mac_code/xterm-file-manager
wails dev
```

开发模式下可以看到实时的控制台输出。
