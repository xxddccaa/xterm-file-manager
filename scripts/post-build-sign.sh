#!/bin/bash
# Post-build script to re-sign the app with entitlements
# This removes the sandbox restrictions to avoid file access permission prompts

APP_PATH="build/bin/xterm-file-manager.app"
ENTITLEMENTS="build/darwin/xterm-file-manager.entitlements"

echo "🔐 Re-signing app with custom entitlements..."
codesign -s - --deep --force --entitlements "$ENTITLEMENTS" "$APP_PATH"

if [ $? -eq 0 ]; then
    echo "✅ App successfully signed without sandbox restrictions"
    echo "📝 Verifying entitlements..."
    codesign -d --entitlements :- "$APP_PATH" 2>&1 | grep -q "app-sandbox.*false"
    if [ $? -eq 0 ]; then
        echo "✅ Sandbox disabled - no more file permission prompts!"
    fi
else
    echo "❌ Failed to sign app"
    exit 1
fi
