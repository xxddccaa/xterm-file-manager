#!/bin/bash
# XTerm File Manager - Keyboard Shortcuts Test Script

set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║   XTerm File Manager - Keyboard Shortcuts Diagnostic Tool    ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Color codes
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

APP_PATH="/Users/xd/Documents/xiedong_dev/mac_code/xterm-file-manager/build/bin/xterm-file-manager.app"
LOG_FILE="/tmp/xterm-file-manager-debug.log"

# Step 1: Get Bundle Identifier
echo -e "${BLUE}[1/6]${NC} Getting application Bundle Identifier..."
BUNDLE_ID=$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$APP_PATH/Contents/Info.plist" 2>/dev/null || echo "")

if [ -z "$BUNDLE_ID" ]; then
    echo -e "${RED}   ❌ Could not find Bundle Identifier${NC}"
    echo -e "${YELLOW}   App might not be built yet. Run: wails build${NC}"
    exit 1
else
    echo -e "${GREEN}   ✅ Bundle ID: ${BUNDLE_ID}${NC}"
fi

# Step 2: Check if Karabiner is running
echo ""
echo -e "${BLUE}[2/6]${NC} Checking Karabiner-Elements status..."
if pgrep -x "karabiner_console_user_server" > /dev/null; then
    echo -e "${YELLOW}   ⚠️  Karabiner-Elements is RUNNING${NC}"
    echo -e "${YELLOW}   This might block keyboard events!${NC}"
    KARABINER_RUNNING=true
else
    echo -e "${GREEN}   ✅ Karabiner-Elements is NOT running${NC}"
    KARABINER_RUNNING=false
fi

# Step 3: Clear old log
echo ""
echo -e "${BLUE}[3/6]${NC} Clearing old debug log..."
rm -f "$LOG_FILE"
echo -e "${GREEN}   ✅ Log cleared: $LOG_FILE${NC}"

# Step 4: Launch application
echo ""
echo -e "${BLUE}[4/6]${NC} Launching application..."
if [ -d "$APP_PATH" ]; then
    open "$APP_PATH"
    echo -e "${GREEN}   ✅ Application launched${NC}"
else
    echo -e "${RED}   ❌ Application not found at: $APP_PATH${NC}"
    echo -e "${YELLOW}   Build the app first: wails build${NC}"
    exit 1
fi

# Step 5: Wait for app to start
echo ""
echo -e "${BLUE}[5/6]${NC} Waiting for application to initialize..."
echo -e "${YELLOW}   Please wait 5 seconds...${NC}"
sleep 5

# Step 6: Interactive testing
echo ""
echo -e "${BLUE}[6/6]${NC} Interactive Testing Phase"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo -e "${YELLOW}Please perform the following tests in the application:${NC}"
echo ""
echo "  1. ${GREEN}F2 Rename Test:${NC}"
echo "     - Click on a file in Remote Files or Local Files"
echo "     - Press ${GREEN}F2${NC} key"
echo "     - You should see a rename dialog"
echo ""
echo "  2. ${GREEN}Ctrl+C Copy Test:${NC}"
echo "     - Click in the terminal pane"
echo "     - Select some text with mouse"
echo "     - Press ${GREEN}Ctrl+C${NC}"
echo "     - Text should be copied"
echo ""
echo "  3. ${GREEN}Ctrl+C Interrupt Test:${NC}"
echo "     - Click in the terminal pane"
echo "     - Type a command (don't execute)"
echo "     - Press ${GREEN}Ctrl+C${NC} (without selecting text)"
echo "     - Command should be cancelled (show ^C)"
echo ""
echo "  4. ${GREEN}Ctrl+D Test:${NC}"
echo "     - In terminal, type: ${GREEN}cat${NC} and press Enter"
echo "     - Press ${GREEN}Ctrl+D${NC}"
echo "     - Cat command should exit"
echo ""
echo "  5. ${GREEN}Ctrl+V Paste Test:${NC}"
echo "     - Copy some text"
echo "     - Click in terminal"
echo "     - Press ${GREEN}Ctrl+V${NC}"
echo "     - Text should be pasted"
echo ""
echo -e "${YELLOW}After testing, press Enter to see the log results...${NC}"
read -p ""

# Check log file
echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                      DIAGNOSTIC RESULTS                       ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

if [ -f "$LOG_FILE" ]; then
    LOG_SIZE=$(wc -l < "$LOG_FILE")
    echo -e "${GREEN}✅ Log file exists: $LOG_FILE${NC}"
    echo -e "${GREEN}   Lines: $LOG_SIZE${NC}"
    echo ""
    
    # Check for specific log patterns
    echo "Analyzing log contents:"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    if grep -q "FileManager.*KeyDown" "$LOG_FILE"; then
        echo -e "${GREEN}✅ FileManager keyboard events detected${NC}"
    else
        echo -e "${RED}❌ No FileManager keyboard events (F2 not working)${NC}"
    fi
    
    if grep -q "LocalFileManager.*KeyDown" "$LOG_FILE"; then
        echo -e "${GREEN}✅ LocalFileManager keyboard events detected${NC}"
    else
        echo -e "${RED}❌ No LocalFileManager keyboard events${NC}"
    fi
    
    if grep -q "Terminal.*KeyEvent" "$LOG_FILE"; then
        echo -e "${GREEN}✅ Terminal keyboard events detected${NC}"
    else
        echo -e "${RED}❌ No Terminal keyboard events (Ctrl+C/D not working)${NC}"
    fi
    
    if grep -q "F2 pressed" "$LOG_FILE"; then
        echo -e "${GREEN}✅ F2 key was pressed and detected${NC}"
    else
        echo -e "${YELLOW}⚠️  F2 key was NOT detected${NC}"
    fi
    
    if grep -q "Ctrl+C detected" "$LOG_FILE"; then
        echo -e "${GREEN}✅ Ctrl+C was pressed and detected${NC}"
    else
        echo -e "${YELLOW}⚠️  Ctrl+C was NOT detected${NC}"
    fi
    
    if grep -q "Ctrl+D passing through" "$LOG_FILE"; then
        echo -e "${GREEN}✅ Ctrl+D was pressed and detected${NC}"
    else
        echo -e "${YELLOW}⚠️  Ctrl+D was NOT detected${NC}"
    fi
    
    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
    echo -e "${BLUE}Full log contents:${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    cat "$LOG_FILE"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
else
    echo -e "${RED}❌ No log file found at: $LOG_FILE${NC}"
    echo ""
    echo -e "${YELLOW}This means keyboard events are NOT reaching the application!${NC}"
    echo ""
    
    if [ "$KARABINER_RUNNING" = true ]; then
        echo -e "${RED}╔═══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}║             KARABINER-ELEMENTS IS BLOCKING EVENTS             ║${NC}"
        echo -e "${RED}╚═══════════════════════════════════════════════════════════════╝${NC}"
        echo ""
        echo -e "${YELLOW}Solution: Add the following to Karabiner-Elements config:${NC}"
        echo ""
        echo "Bundle Identifier: ${GREEN}$BUNDLE_ID${NC}"
        echo ""
        echo "Steps:"
        echo "  1. Open Karabiner-Elements"
        echo "  2. Go to 'Complex Modifications' tab"
        echo "  3. Click 'Add rule' → Add your app exception"
        echo "  4. Or edit: ~/.config/karabiner/karabiner.json"
        echo ""
        echo "See KARABINER_SETUP.md for detailed instructions."
    else
        echo -e "${YELLOW}Possible causes:${NC}"
        echo "  - Application didn't start properly"
        echo "  - Logger initialization failed"
        echo "  - File permissions issue"
    fi
fi

echo ""
echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║                         NEXT STEPS                            ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

if [ ! -f "$LOG_FILE" ] && [ "$KARABINER_RUNNING" = true ]; then
    echo "1. Configure Karabiner-Elements (see KARABINER_SETUP.md)"
    echo "2. Or temporarily quit Karabiner to test:"
    echo "   - Click Karabiner menu bar icon"
    echo "   - Select 'Quit Karabiner-Elements'"
    echo "3. Run this script again to verify"
elif [ -f "$LOG_FILE" ]; then
    echo -e "${GREEN}✅ Keyboard events are being logged!${NC}"
    echo ""
    echo "If shortcuts still don't work in the UI:"
    echo "  1. Check if the events show the correct keys"
    echo "  2. Verify focus is in the right panel"
    echo "  3. Share the log above for further diagnosis"
else
    echo "1. Verify the app is running"
    echo "2. Try clicking different panels in the app"
    echo "3. Run this script again"
fi

echo ""
echo "Log file location: ${GREEN}$LOG_FILE${NC}"
echo "Keep monitoring: ${GREEN}tail -f $LOG_FILE${NC}"
echo ""
