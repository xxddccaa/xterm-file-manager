package main

import (
	"context"
	"embed"
	"encoding/json"
	"fmt"
	"io/fs"
	"log"
	"os"
	"runtime"
	"runtime/debug"
	"sync"

	"xterm-file-manager/internal/app"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	wailsRuntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Add global panic recovery
	defer func() {
		if r := recover(); r != nil {
			log.Printf("❌ PANIC RECOVERED in main: %v", r)
			log.Printf("Stack trace:\n%s", debug.Stack())

			// Try to write to a log file for debugging
			if logFile, err := os.OpenFile("xterm-file-manager-crash.log", os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0644); err == nil {
				defer logFile.Close()
				fmt.Fprintf(logFile, "PANIC RECOVERED: %v\n", r)
				fmt.Fprintf(logFile, "Stack trace:\n%s\n", debug.Stack())
			}
		}
	}()

	// File open queue: OnFileOpen may fire before Startup completes,
	// so we buffer file paths and process them after the app is ready.
	var (
		pendingFilesMu sync.Mutex
		pendingFiles   []string
		appReady       bool
	)

	// Create an instance of the app structure
	appInstance := app.NewApp()

	// Extract the frontend/dist sub-filesystem for the asset server.
	// In production (wails build): contains the full compiled frontend.
	// In development (wails dev): Wails automatically overrides this with
	// the Vite dev server configured in wails.json (frontend:dev:serverUrl).
	distFS, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatal("Failed to get sub filesystem:", err)
	}

	// Create application menu with standard macOS menus
	appMenu := menu.NewMenu()

	// 1. Standard macOS App menu (About, Services, Hide, Quit)
	appMenu.Append(menu.AppMenu())

	// 2. Standard Edit menu (Undo, Redo, Cut, Copy, Paste, SelectAll)
	//    This is REQUIRED on macOS for clipboard operations (Cmd+C/V) to work in WebView
	appMenu.Append(menu.EditMenu())

	// 3. Preferences menu with Terminal settings
	preferencesMenu := appMenu.AddSubmenu("Preferences")
	terminalMenu := preferencesMenu.AddSubmenu("Terminal")

	// Enable Select-to-Copy menu item
	toggleSelectToCopy := &menu.MenuItem{
		Label:   "Enable Select-to-Copy",
		Type:    menu.CheckboxType,
		Checked: true,
	}
	toggleSelectToCopy.Click = func(cd *menu.CallbackData) {
		settingsJSON, err := appInstance.GetTerminalSettings()
		if err != nil {
			log.Printf("Failed to get settings: %v", err)
			return
		}

		var settings app.TerminalSettings
		if err := json.Unmarshal([]byte(settingsJSON), &settings); err != nil {
			log.Printf("Failed to parse settings: %v", err)
			return
		}

		settings.EnableSelectToCopy = !settings.EnableSelectToCopy

		newSettingsJSON, _ := json.Marshal(settings)
		if err := appInstance.SetTerminalSettings(string(newSettingsJSON)); err != nil {
			log.Printf("Failed to save settings: %v", err)
		} else {
			toggleSelectToCopy.Checked = settings.EnableSelectToCopy
		}
	}

	// Enable Right-Click-Paste menu item
	toggleRightClickPaste := &menu.MenuItem{
		Label:   "Enable Right-Click-Paste",
		Type:    menu.CheckboxType,
		Checked: true,
	}
	toggleRightClickPaste.Click = func(cd *menu.CallbackData) {
		settingsJSON, err := appInstance.GetTerminalSettings()
		if err != nil {
			log.Printf("Failed to get settings: %v", err)
			return
		}

		var settings app.TerminalSettings
		if err := json.Unmarshal([]byte(settingsJSON), &settings); err != nil {
			log.Printf("Failed to parse settings: %v", err)
			return
		}

		settings.EnableRightClickPaste = !settings.EnableRightClickPaste

		newSettingsJSON, _ := json.Marshal(settings)
		if err := appInstance.SetTerminalSettings(string(newSettingsJSON)); err != nil {
			log.Printf("Failed to save settings: %v", err)
		} else {
			toggleRightClickPaste.Checked = settings.EnableRightClickPaste
		}
	}

	terminalMenu.Items = append(terminalMenu.Items, toggleSelectToCopy, toggleRightClickPaste)

	// 4. Standard macOS Window menu (Minimize, Zoom, etc.)
	appMenu.Append(menu.WindowMenu())

	// Create startup function to initialize menu items from settings
	startupFunc := func(ctx context.Context) {
		// Call app.Startup first
		appInstance.Startup(ctx)

		// Initialize menu items from settings
		settingsJSON, err := appInstance.GetTerminalSettings()
		if err != nil {
			log.Printf("Failed to get settings on startup: %v", err)
			return
		}

		var settings app.TerminalSettings
		if err := json.Unmarshal([]byte(settingsJSON), &settings); err != nil {
			log.Printf("Failed to parse settings on startup: %v", err)
			return
		}

		// Update menu item checked states
		toggleSelectToCopy.Checked = settings.EnableSelectToCopy
		toggleRightClickPaste.Checked = settings.EnableRightClickPaste

		// Process any files that were queued before Startup completed (macOS OnFileOpen)
		pendingFilesMu.Lock()
		appReady = true
		filesToOpen := make([]string, len(pendingFiles))
		copy(filesToOpen, pendingFiles)
		pendingFiles = nil
		pendingFilesMu.Unlock()

		// On Windows, file association passes file paths as command-line arguments
		if runtime.GOOS == "windows" {
			argsWithoutProg := os.Args[1:]
			for _, arg := range argsWithoutProg {
				// Skip flags (e.g. --debug)
				if len(arg) > 0 && arg[0] == '-' {
					continue
				}
				filesToOpen = append(filesToOpen, arg)
			}
		}

		// Open all pending files: on macOS use native editor window,
		// on other platforms emit event to open in the main window's EditorTab
		for _, filePath := range filesToOpen {
			log.Printf("📂 [FileOpen] Opening queued file: %s", filePath)
			if runtime.GOOS == "darwin" {
				if err := appInstance.OpenEditorWindow(filePath, false, ""); err != nil {
					log.Printf("❌ [FileOpen] Failed to open queued file %s: %v", filePath, err)
				}
			} else {
				wailsRuntime.EventsEmit(ctx, "editor:open-file", filePath)
			}
		}
	}

	// Shutdown function: cleanup temp directories used for clipboard operations
	shutdownFunc := func(ctx context.Context) {
		log.Printf("🧹 App shutting down, cleaning temp directories...")
		app.CleanupTempDirs()
	}

	// Create application with options
	err = wails.Run(&options.App{
		Title:            "XTerm File Manager",
		Width:            1400,
		Height:           900,
		MinWidth:         800,
		MinHeight:        600,
		BackgroundColour: &options.RGBA{R: 30, G: 30, B: 30, A: 255},
		OnStartup:        startupFunc,
		OnShutdown:       shutdownFunc,
		Menu:             appMenu,
		AssetServer: &assetserver.Options{
			Assets: distFS,
		},
		Bind: []interface{}{
			appInstance,
		},
		DragAndDrop: &options.DragAndDrop{
			EnableFileDrop:     true,
			DisableWebViewDrop: true,
		},
		Mac: &mac.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
			OnFileOpen: func(filePath string) {
				pendingFilesMu.Lock()
				defer pendingFilesMu.Unlock()

				if appReady {
					// App is ready, open file directly in editor
					log.Printf("📂 [FileOpen] Opening file: %s", filePath)
					if err := appInstance.OpenEditorWindow(filePath, false, ""); err != nil {
						log.Printf("❌ [FileOpen] Failed to open file %s: %v", filePath, err)
					}
				} else {
					// App not ready yet, queue file for later
					log.Printf("📂 [FileOpen] App not ready, queuing file: %s", filePath)
					pendingFiles = append(pendingFiles, filePath)
				}
			},
		},
		EnableDefaultContextMenu:         false,
		EnableFraudulentWebsiteDetection: false,
	})

	if err != nil {
		log.Fatal("Error:", err)
	}
}
