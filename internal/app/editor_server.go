package app

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/url"
	"path/filepath"
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
	mux.HandleFunc("/api/read-file", a.handleReadFile)
	mux.HandleFunc("/api/write-file", a.handleWriteFile)

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
