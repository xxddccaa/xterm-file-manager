package app

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var editorServerPort int

// StartEditorServer starts a lightweight HTTP server for standalone editor windows.
// The editor opens in the system browser as a truly independent window.
func (a *App) StartEditorServer() error {
	// Find an available port
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return fmt.Errorf("failed to find available port: %v", err)
	}
	editorServerPort = listener.Addr().(*net.TCPAddr).Port
	listener.Close()

	mux := http.NewServeMux()
	mux.HandleFunc("/editor", a.handleEditorPage)
	mux.HandleFunc("/file-browser", a.handleFileBrowserPage)
	mux.HandleFunc("/api/read-file", a.handleReadFile)
	mux.HandleFunc("/api/write-file", a.handleWriteFile)
	mux.HandleFunc("/api/list-files", a.handleListFiles)
	mux.HandleFunc("/api/file-operation", a.handleFileOperation)

	go func() {
		addr := fmt.Sprintf("127.0.0.1:%d", editorServerPort)
		log.Printf("📝 Editor server started at http://%s", addr)
		if err := http.ListenAndServe(addr, mux); err != nil {
			log.Printf("❌ Editor server error: %v", err)
		}
	}()

	return nil
}

// OpenEditorWindow opens a file in a native macOS window (NSWindow + WKWebView).
// This creates a truly independent OS-level window, not a browser tab.
func (a *App) OpenEditorWindow(filePath string, isRemote bool, sessionID string) error {
	if editorServerPort == 0 {
		return fmt.Errorf("editor server not started")
	}

	editorURL := fmt.Sprintf("http://127.0.0.1:%d/editor?file=%s&remote=%v&session=%s",
		editorServerPort,
		url.QueryEscape(filePath),
		isRemote,
		url.QueryEscape(sessionID),
	)

	fileName := filepath.Base(filePath)
	OpenNativeWindow(editorURL, fileName+" - XTerm Editor", 900, 700)
	return nil
}

// ShowAllEditorWindows brings all editor windows to front (callable from frontend).
func (a *App) ShowAllEditorWindows() {
	BringAllEditorWindowsToFront()
}

// GetOpenEditorCount returns the number of currently open editor windows.
func (a *App) GetOpenEditorCount() int {
	return GetEditorWindowCount()
}

// handleEditorPage serves the standalone editor HTML page
func (a *App) handleEditorPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(editorHTML))
}

// handleReadFile handles file read API requests
func (a *App) handleReadFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	filePath := r.URL.Query().Get("file")
	isRemote := r.URL.Query().Get("remote") == "true"
	sessionID := r.URL.Query().Get("session")

	var content string
	var err error

	if isRemote {
		content, err = a.ReadRemoteFile(sessionID, filePath)
	} else {
		content, err = a.ReadLocalFile(filePath)
	}

	if err != nil {
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	json.NewEncoder(w).Encode(map[string]string{"content": content})
}

// handleWriteFile handles file write API requests
func (a *App) handleWriteFile(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		return
	}

	var req struct {
		File    string `json:"file"`
		Remote  bool   `json:"remote"`
		Session string `json:"session"`
		Content string `json:"content"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	var err error
	if req.Remote {
		err = a.WriteRemoteFile(req.Session, req.File, req.Content)
	} else {
		err = a.WriteLocalFile(req.File, req.Content)
	}

	if err != nil {
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// OpenFileBrowserWindow opens a file browser in a native macOS window
func (a *App) OpenFileBrowserWindow(dirPath string) error {
	if editorServerPort == 0 {
		return fmt.Errorf("editor server not started")
	}

	browserURL := fmt.Sprintf("http://127.0.0.1:%d/file-browser?path=%s",
		editorServerPort,
		url.QueryEscape(dirPath),
	)

	dirName := filepath.Base(dirPath)
	OpenNativeWindow(browserURL, dirName+" - XTerm Files", 1000, 700)
	return nil
}

// OpenTerminalAtPath emits an event to the frontend to open a local terminal at the given path
func (a *App) OpenTerminalAtPath(dirPath string) error {
	expanded, err := expandHome(dirPath)
	if err != nil {
		return err
	}

	// Verify directory exists
	info, err := os.Stat(expanded)
	if err != nil {
		return fmt.Errorf("path does not exist: %v", err)
	}
	if !info.IsDir() {
		return fmt.Errorf("path is not a directory: %s", expanded)
	}

	log.Printf("🖥️ Opening terminal at: %s", expanded)
	runtime.EventsEmit(a.ctx, "files:open-terminal", expanded)
	return nil
}

// handleFileBrowserPage serves the standalone file browser HTML page
func (a *App) handleFileBrowserPage(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Write([]byte(fileBrowserHTML))
}

// handleListFiles handles directory listing API requests for standalone windows
func (a *App) handleListFiles(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	dirPath := r.URL.Query().Get("path")
	if dirPath == "" {
		homeDir, _ := os.UserHomeDir()
		dirPath = homeDir
	}

	files, err := a.ListLocalFiles(dirPath)
	if err != nil {
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{"files": files, "path": dirPath})
}

// handleFileOperation handles file operations (copy, move, delete, mkdir) for standalone windows
func (a *App) handleFileOperation(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != "POST" {
		w.WriteHeader(http.StatusMethodNotAllowed)
		json.NewEncoder(w).Encode(map[string]string{"error": "method not allowed"})
		return
	}

	var req struct {
		Operation string `json:"operation"` // "copy", "move", "delete", "mkdir", "rename"
		Src       string `json:"src"`
		Dst       string `json:"dst"`
		Name      string `json:"name"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	var err error
	switch req.Operation {
	case "copy":
		info, statErr := os.Stat(req.Src)
		if statErr != nil {
			err = statErr
		} else if info.IsDir() {
			err = a.CopyLocalDirectory(req.Src, req.Dst)
		} else {
			err = a.CopyLocalFile(req.Src, req.Dst)
		}
	case "move":
		err = a.MoveLocalFile(req.Src, req.Dst)
	case "delete":
		info, statErr := os.Stat(req.Src)
		if statErr != nil {
			err = statErr
		} else if info.IsDir() {
			err = a.DeleteLocalDirectory(req.Src)
		} else {
			err = a.DeleteLocalFile(req.Src)
		}
	case "mkdir":
		err = a.CreateLocalDirectory(req.Dst)
	case "rename":
		err = a.RenameLocalFile(req.Src, req.Name)
	default:
		err = fmt.Errorf("unknown operation: %s", req.Operation)
	}

	if err != nil {
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
		return
	}

	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// editorHTML is the standalone editor page served to the browser.
// Uses Monaco Editor from CDN, dark theme, Cmd+S save, unsaved warning.
const editorHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Editor</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; overflow: hidden; }
body {
  background: #1e1e1e; color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  display: flex; flex-direction: column;
}
#titlebar {
  display: flex; align-items: center; height: 40px; padding: 0 14px;
  background: #323233; border-bottom: 1px solid #404040;
  gap: 10px; user-select: none; flex-shrink: 0;
}
#filename { font-size: 14px; font-weight: 600; white-space: nowrap; }
#modified { color: #1890ff; font-size: 18px; display: none; }
#filepath {
  font-size: 11px; color: #888; font-family: Monaco, Menlo, monospace;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;
}
#save-btn {
  margin-left: auto; padding: 4px 14px; background: #0e639c; color: #fff;
  border: none; border-radius: 3px; cursor: pointer; font-size: 12px;
  opacity: 0.5; pointer-events: none; flex-shrink: 0; transition: all 0.15s;
}
#save-btn.active { opacity: 1; pointer-events: auto; }
#save-btn.active:hover { background: #1177bb; }
#save-btn.saving { opacity: 0.7; pointer-events: none; }
#editor-container { flex: 1; overflow: hidden; position: relative; }
#loading {
  position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%);
  color: #888; font-size: 14px; text-align: center;
}
#loading .spinner {
  width: 32px; height: 32px; border: 3px solid #444; border-top-color: #007acc;
  border-radius: 50%; animation: spin 0.8s linear infinite;
  margin: 0 auto 12px;
}
@keyframes spin { to { transform: rotate(360deg); } }
#statusbar {
  display: flex; align-items: center; justify-content: space-between;
  height: 24px; padding: 0 12px; background: #007acc;
  font-size: 11px; color: #fff; flex-shrink: 0; user-select: none;
}
#fallback-editor {
  width: 100%; height: 100%; background: #1e1e1e; color: #d4d4d4;
  border: none; outline: none; resize: none; padding: 12px;
  font-family: Monaco, Menlo, 'Courier New', monospace; font-size: 14px;
  line-height: 1.5; tab-size: 2; display: none;
}
</style>
</head>
<body>
<div id="titlebar">
  <span id="filename">Loading...</span>
  <span id="modified">&#9679;</span>
  <span id="filepath"></span>
  <button id="save-btn" onclick="saveFile()">Save</button>
</div>
<div id="editor-container">
  <div id="loading"><div class="spinner"></div>Loading editor...</div>
  <textarea id="fallback-editor" spellcheck="false"></textarea>
</div>
<div id="statusbar">
  <span id="status-left"></span>
  <span id="status-right"></span>
</div>

<script src="https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/loader.min.js"></script>
<script>
(function() {
  var params = new URLSearchParams(window.location.search);
  var filePath = params.get("file") || "";
  var isRemote = params.get("remote") === "true";
  var sessionId = params.get("session") || "";
  var fileName = filePath.split("/").pop() || "Untitled";
  var originalContent = "";
  var isModified = false;
  var editor = null;
  var useFallback = false;

  // Update UI
  document.title = fileName + " - XTerm Editor";
  document.getElementById("filename").textContent = fileName;
  document.getElementById("filepath").textContent = filePath;
  document.getElementById("status-left").textContent = isRemote ? "\uD83C\uDF10 Remote" : "\uD83D\uDCBB Local";

  // Language detection
  function getLanguage(path) {
    var ext = (path.split(".").pop() || "").toLowerCase();
    var map = {
      "js":"javascript","jsx":"javascript","ts":"typescript","tsx":"typescript",
      "json":"json","py":"python","go":"go","rs":"rust","java":"java",
      "c":"c","cpp":"cpp","cc":"cpp","h":"c","hpp":"cpp","cs":"csharp",
      "php":"php","rb":"ruby","sh":"shell","bash":"shell","zsh":"shell",
      "sql":"sql","html":"html","htm":"html","xml":"xml",
      "css":"css","scss":"scss","less":"less","md":"markdown",
      "yaml":"yaml","yml":"yaml","toml":"toml","ini":"ini",
      "txt":"plaintext","conf":"ini","log":"plaintext",
      "makefile":"makefile","dockerfile":"dockerfile"
    };
    return map[ext] || "plaintext";
  }

  var language = getLanguage(filePath);
  document.getElementById("status-right").textContent = language;

  function setModified(mod) {
    isModified = mod;
    document.getElementById("modified").style.display = mod ? "inline" : "none";
    document.getElementById("save-btn").className = mod ? "active" : "";
    document.title = (mod ? "\u25CF " : "") + fileName + " - XTerm Editor";
  }

  // Save file
  window.saveFile = function() {
    if (!isModified) return;
    var content = editor ? editor.getValue() : document.getElementById("fallback-editor").value;
    var btn = document.getElementById("save-btn");
    btn.className = "saving";
    btn.textContent = "Saving...";

    fetch("/api/write-file", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file: filePath,
        remote: isRemote,
        session: sessionId,
        content: content
      })
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.success) {
        originalContent = content;
        setModified(false);
        btn.textContent = "Saved!";
        setTimeout(function() { btn.textContent = "Save"; }, 1500);
      } else {
        alert("Save failed: " + (data.error || "Unknown error"));
        btn.className = "active";
        btn.textContent = "Save";
      }
    })
    .catch(function(err) {
      alert("Save failed: " + err.message);
      btn.className = "active";
      btn.textContent = "Save";
    });
  };

  // Keyboard shortcut: Cmd+S / Ctrl+S
  document.addEventListener("keydown", function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      window.saveFile();
    }
  });

  // Warn before close if modified
  window.onbeforeunload = function(e) {
    if (isModified) {
      e.preventDefault();
      e.returnValue = "";
    }
  };

  // Load file content
  function loadFileContent(callback) {
    var apiUrl = "/api/read-file?file=" + encodeURIComponent(filePath)
      + "&remote=" + isRemote + "&session=" + encodeURIComponent(sessionId);
    fetch(apiUrl)
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          alert("Failed to load file: " + data.error);
          return;
        }
        originalContent = data.content;
        callback(data.content);
      })
      .catch(function(err) {
        alert("Failed to load file: " + err.message);
      });
  }

  // Fallback textarea editor
  function initFallbackEditor() {
    useFallback = true;
    document.getElementById("loading").style.display = "none";
    var ta = document.getElementById("fallback-editor");
    ta.style.display = "block";
    loadFileContent(function(content) {
      ta.value = content;
      setModified(false);
    });
    ta.addEventListener("input", function() {
      setModified(ta.value !== originalContent);
    });
  }

  // Timeout: if Monaco fails to load in 8s, use fallback
  var fallbackTimer = setTimeout(function() {
    if (!editor) {
      console.warn("Monaco failed to load, using fallback textarea");
      initFallbackEditor();
    }
  }, 8000);

  // Monaco worker config for CDN
  window.MonacoEnvironment = {
    getWorkerUrl: function(workerId, label) {
      return "data:text/javascript;charset=utf-8," + encodeURIComponent(
        "self.MonacoEnvironment = { baseUrl: \"https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/\" };" +
        "importScripts(\"https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/base/worker/workerMain.js\");"
      );
    }
  };

  // Load Monaco Editor
  if (typeof require !== "undefined" && require.config) {
    require.config({
      paths: { "vs": "https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs" }
    });

    require(["vs/editor/editor.main"], function() {
      clearTimeout(fallbackTimer);
      if (useFallback) return;

      document.getElementById("loading").style.display = "none";

      editor = monaco.editor.create(document.getElementById("editor-container"), {
        value: "",
        language: language,
        theme: "vs-dark",
        automaticLayout: true,
        minimap: { enabled: true },
        fontSize: 14,
        lineNumbers: "on",
        rulers: [80, 120],
        scrollBeyondLastLine: false,
        tabSize: 2,
        insertSpaces: true,
        wordWrap: "off",
        renderWhitespace: "selection"
      });

      // Cmd+S in Monaco
      editor.addCommand(2048 | 49, function() { window.saveFile(); });

      // Track changes
      editor.onDidChangeModelContent(function() {
        var current = editor.getValue();
        setModified(current !== originalContent);
      });

      // Load file
      loadFileContent(function(content) {
        editor.setValue(content);
        setModified(false);
      });
    });
  } else {
    // AMD loader not available
    clearTimeout(fallbackTimer);
    initFallbackEditor();
  }
})();
</script>
</body>
</html>`

// fileBrowserHTML is the standalone file browser page for independent windows.
const fileBrowserHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>File Browser</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { height: 100%; overflow: hidden; }
body {
  background: #1e1e1e; color: #e0e0e0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  display: flex; flex-direction: column;
}
#toolbar {
  display: flex; align-items: center; height: 40px; padding: 0 10px;
  background: #252526; border-bottom: 1px solid #3e3e42;
  gap: 4px; user-select: none; flex-shrink: 0;
}
.nav-btn {
  background: none; border: none; color: #ccc; font-size: 16px;
  cursor: pointer; padding: 4px 8px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
}
.nav-btn:hover:not(:disabled) { background: #3e3e42; color: #fff; }
.nav-btn:disabled { opacity: 0.3; cursor: default; }
#path-bar {
  flex: 1; display: flex; align-items: center; gap: 2px;
  background: #1e1e1e; border: 1px solid #3e3e42; border-radius: 4px;
  padding: 0 8px; height: 28px; margin: 0 6px; overflow: hidden;
}
#path-bar .crumb {
  color: #ccc; font-size: 12px; cursor: pointer; padding: 2px 4px;
  border-radius: 3px; white-space: nowrap;
}
#path-bar .crumb:hover { background: #3e3e42; color: #fff; }
#path-bar .sep { color: #666; font-size: 11px; }
#path-input {
  flex: 1; background: #1e1e1e; border: 1px solid #1890ff; color: #e0e0e0;
  font-size: 12px; font-family: Monaco, Menlo, monospace; padding: 0 8px;
  height: 28px; margin: 0 6px; border-radius: 4px; outline: none;
  display: none;
}
#file-list {
  flex: 1; overflow-y: auto; padding: 4px;
}
.file-item {
  display: flex; align-items: center; gap: 8px; padding: 5px 10px;
  border-radius: 4px; cursor: pointer; user-select: none;
  font-size: 12px; color: #c0c0c0;
}
.file-item:hover { background: rgba(255,255,255,0.06); }
.file-item.selected { background: rgba(24,144,255,0.15); border: 1px solid rgba(24,144,255,0.3); padding: 4px 9px; }
.file-item.dir { color: #e0e0e0; }
.file-icon { font-size: 15px; width: 20px; text-align: center; flex-shrink: 0; }
.file-icon.folder { color: #e8a838; }
.file-icon.file { color: #888; }
.file-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-size { color: #777; font-size: 11px; min-width: 70px; text-align: right; flex-shrink: 0; }
.file-date { color: #666; font-size: 11px; min-width: 140px; text-align: right; flex-shrink: 0; }
#statusbar {
  display: flex; align-items: center; justify-content: space-between;
  height: 24px; padding: 0 12px; background: #007acc;
  font-size: 11px; color: #fff; flex-shrink: 0; user-select: none;
}
.context-menu {
  position: fixed; background: #2d2d2d; border: 1px solid #4d4d4d;
  border-radius: 6px; padding: 4px 0; min-width: 180px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.4); z-index: 1000;
}
.context-menu-item {
  display: flex; align-items: center; gap: 10px; padding: 8px 14px;
  color: #e0e0e0; font-size: 13px; cursor: pointer;
}
.context-menu-item:hover { background: rgba(24,144,255,0.15); color: #1890ff; }
.context-menu-item.danger { color: #ff4d4f; }
.context-menu-item.danger:hover { background: rgba(255,77,79,0.15); }
.context-menu-divider { height: 1px; background: #4d4d4d; margin: 4px 0; }
#loading { display: flex; align-items: center; justify-content: center; height: 100%; color: #888; }
</style>
</head>
<body>
<div id="toolbar">
  <button class="nav-btn" id="btn-back" title="Back" onclick="goBack()" disabled>&#x2190;</button>
  <button class="nav-btn" id="btn-forward" title="Forward" onclick="goForward()" disabled>&#x2192;</button>
  <button class="nav-btn" id="btn-up" title="Up" onclick="goUp()">&#x2191;</button>
  <div id="path-bar" onclick="startEditPath()"></div>
  <input id="path-input" onkeydown="handlePathKey(event)" onblur="cancelEditPath()">
  <button class="nav-btn" title="Refresh" onclick="refresh()">&#x21BB;</button>
</div>
<div id="file-list"><div id="loading">Loading...</div></div>
<div id="statusbar">
  <span id="status-left"></span>
  <span id="status-right"></span>
</div>
<div id="context-menu" class="context-menu" style="display:none"></div>

<script>
(function() {
  var params = new URLSearchParams(window.location.search);
  var currentPath = params.get("path") || "";
  var backStack = [];
  var forwardStack = [];
  var files = [];
  var selectedFile = null;

  function formatSize(bytes) {
    if (bytes === 0) return "-";
    var k = 1024;
    var sizes = ["B","KB","MB","GB"];
    var i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  function formatDate(isoStr) {
    if (!isoStr) return "";
    var d = new Date(isoStr);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"});
  }

  function updateNav() {
    document.getElementById("btn-back").disabled = backStack.length === 0;
    document.getElementById("btn-forward").disabled = forwardStack.length === 0;
    document.getElementById("btn-up").disabled = currentPath === "/";
  }

  function renderBreadcrumbs() {
    var bar = document.getElementById("path-bar");
    bar.innerHTML = "";
    var parts = currentPath.split("/").filter(Boolean);
    // Root
    var root = document.createElement("span");
    root.className = "crumb";
    root.textContent = "/";
    root.onclick = function(e) { e.stopPropagation(); navigateTo("/"); };
    bar.appendChild(root);
    var accumulated = "";
    for (var i = 0; i < parts.length; i++) {
      accumulated += "/" + parts[i];
      var sep = document.createElement("span");
      sep.className = "sep";
      sep.textContent = "›";
      bar.appendChild(sep);
      var crumb = document.createElement("span");
      crumb.className = "crumb";
      crumb.textContent = parts[i];
      (function(p) {
        crumb.onclick = function(e) { e.stopPropagation(); navigateTo(p); };
      })(accumulated);
      bar.appendChild(crumb);
    }
  }

  function renderFiles() {
    var list = document.getElementById("file-list");
    list.innerHTML = "";
    // Sort: dirs first, then alphabetical
    files.sort(function(a, b) {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });
    if (files.length === 0) {
      list.innerHTML = '<div style="text-align:center;color:#666;padding:40px">Empty directory</div>';
      return;
    }
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var item = document.createElement("div");
      item.className = "file-item" + (f.isDir ? " dir" : "") + (selectedFile === f.name ? " selected" : "");
      item.innerHTML =
        '<span class="file-icon ' + (f.isDir ? "folder" : "file") + '">' + (f.isDir ? "&#128193;" : "&#128196;") + '</span>' +
        '<span class="file-name">' + escapeHtml(f.name) + '</span>' +
        '<span class="file-date">' + formatDate(f.modTime) + '</span>' +
        '<span class="file-size">' + (f.isDir ? "-" : formatSize(f.size)) + '</span>';
      (function(file) {
        item.onclick = function() { selectedFile = file.name; renderFiles(); };
        item.ondblclick = function() {
          if (file.isDir) {
            navigateTo(file.path);
          } else {
            // Open in editor window
            window.open("/editor?file=" + encodeURIComponent(file.path) + "&remote=false&session=", "_blank");
          }
        };
        item.oncontextmenu = function(e) {
          e.preventDefault();
          selectedFile = file.name;
          renderFiles();
          showContextMenu(e.clientX, e.clientY, file);
        };
      })(f);
      list.appendChild(item);
    }
    document.getElementById("status-left").textContent = files.length + " items";
    document.getElementById("status-right").textContent = currentPath;
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  function loadFiles(path) {
    fetch("/api/list-files?path=" + encodeURIComponent(path))
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          alert("Error: " + data.error);
          return;
        }
        currentPath = data.path;
        files = data.files || [];
        selectedFile = null;
        document.title = (currentPath.split("/").pop() || "/") + " - XTerm Files";
        renderBreadcrumbs();
        renderFiles();
        updateNav();
      })
      .catch(function(err) { alert("Failed to load: " + err.message); });
  }

  window.navigateTo = function(path) {
    if (path === currentPath) return;
    backStack.push(currentPath);
    forwardStack = [];
    loadFiles(path);
  };

  window.goBack = function() {
    if (backStack.length === 0) return;
    forwardStack.push(currentPath);
    var prev = backStack.pop();
    loadFiles(prev);
  };

  window.goForward = function() {
    if (forwardStack.length === 0) return;
    backStack.push(currentPath);
    var next = forwardStack.pop();
    loadFiles(next);
  };

  window.goUp = function() {
    if (currentPath === "/") return;
    var parts = currentPath.split("/").filter(Boolean);
    parts.pop();
    var parent = "/" + parts.join("/");
    navigateTo(parent);
  };

  window.refresh = function() {
    loadFiles(currentPath);
  };

  window.startEditPath = function() {
    document.getElementById("path-bar").style.display = "none";
    var input = document.getElementById("path-input");
    input.style.display = "block";
    input.value = currentPath;
    input.focus();
    input.select();
  };

  window.cancelEditPath = function() {
    document.getElementById("path-input").style.display = "none";
    document.getElementById("path-bar").style.display = "flex";
  };

  window.handlePathKey = function(e) {
    if (e.key === "Enter") {
      var newPath = document.getElementById("path-input").value.trim();
      cancelEditPath();
      if (newPath && newPath !== currentPath) {
        navigateTo(newPath);
      }
    } else if (e.key === "Escape") {
      cancelEditPath();
    }
  };

  function showContextMenu(x, y, file) {
    var menu = document.getElementById("context-menu");
    menu.innerHTML = "";
    if (file.isDir) {
      addMenuItem(menu, "Open", function() { navigateTo(file.path); });
    } else {
      addMenuItem(menu, "Edit", function() {
        window.open("/editor?file=" + encodeURIComponent(file.path) + "&remote=false&session=", "_blank");
      });
    }
    addDivider(menu);
    addMenuItem(menu, "Rename", function() {
      var newName = prompt("Rename to:", file.name);
      if (newName && newName !== file.name) {
        fileOp("rename", file.path, "", newName);
      }
    });
    addMenuItem(menu, "Delete", function() {
      if (confirm("Delete " + file.name + "?")) {
        fileOp("delete", file.path, "", "");
      }
    }, true);
    menu.style.left = x + "px";
    menu.style.top = y + "px";
    menu.style.display = "block";
  }

  function addMenuItem(menu, label, fn, danger) {
    var item = document.createElement("div");
    item.className = "context-menu-item" + (danger ? " danger" : "");
    item.textContent = label;
    item.onclick = function() { hideContextMenu(); fn(); };
    menu.appendChild(item);
  }

  function addDivider(menu) {
    var d = document.createElement("div");
    d.className = "context-menu-divider";
    menu.appendChild(d);
  }

  function hideContextMenu() {
    document.getElementById("context-menu").style.display = "none";
  }

  document.addEventListener("click", hideContextMenu);

  function fileOp(op, src, dst, name) {
    fetch("/api/file-operation", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({operation: op, src: src, dst: dst, name: name})
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      if (data.error) alert("Error: " + data.error);
      else refresh();
    })
    .catch(function(err) { alert("Failed: " + err.message); });
  }

  // Keyboard shortcuts
  document.addEventListener("keydown", function(e) {
    if ((e.metaKey || e.ctrlKey) && e.key === "[") { e.preventDefault(); goBack(); }
    if ((e.metaKey || e.ctrlKey) && e.key === "]") { e.preventDefault(); goForward(); }
    if ((e.metaKey || e.ctrlKey) && e.key === "ArrowUp") { e.preventDefault(); goUp(); }
  });

  // Initial load
  loadFiles(currentPath || "");
})();
</script>
</body>
</html>`
