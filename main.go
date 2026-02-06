package main

import (
	"embed"
	"io/fs"
	"log"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Extract the embedded filesystem to serve from the correct subdirectory
	distFS, err := fs.Sub(assets, "frontend/dist")
	if err != nil {
		log.Fatal("Failed to get sub filesystem:", err)
	}

	// Create application with options
	err = wails.Run(&options.App{
		Title:     "XTerm File Manager",
		Width:     1400,
		Height:    900,
		MinWidth:  800,
		MinHeight: 600,
		AssetServer: &assetserver.Options{
			Assets: distFS,
		},
		BackgroundColour: &options.RGBA{R: 30, G: 30, B: 30, A: 1},
		OnStartup:        app.startup,
		// Bind the app methods to the frontend
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		log.Fatal("Error:", err)
	}
}
