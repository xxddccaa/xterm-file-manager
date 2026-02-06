//go:build darwin

package app

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework WebKit

#include <stdlib.h>
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

// ----------------------------------------------------------
// Static arrays to keep strong references (prevent dealloc)
// ----------------------------------------------------------
static NSMutableArray *editorWindows = nil;
static NSMutableArray *editorWindowDelegates = nil;
static BOOL dockMenuInstalled = NO;

// ----------------------------------------------------------
// EditorWindowDelegate: handles window close to clean up refs
// ----------------------------------------------------------
@interface EditorWindowDelegate : NSObject <NSWindowDelegate>
@end

@implementation EditorWindowDelegate

- (void)windowWillClose:(NSNotification *)notification {
    NSWindow *window = notification.object;
    if (editorWindows) {
        // Remove from Window menu
        [NSApp removeWindowsItem:window];
        [editorWindows removeObject:window];
    }
    if (editorWindowDelegates) {
        [editorWindowDelegates removeObject:self];
    }
}

@end

// ----------------------------------------------------------
// Custom Dock menu: shows all editor windows
// ----------------------------------------------------------

// This C function is injected as applicationDockMenu: on Wails' app delegate
NSMenu* customDockMenu(id self, SEL _cmd, NSApplication* sender) {
    NSMenu *dockMenu = [[NSMenu alloc] init];

    if (editorWindows && [editorWindows count] > 0) {
        // Header
        NSMenuItem *header = [[NSMenuItem alloc] initWithTitle:@"Editor Windows"
                                                        action:nil
                                                 keyEquivalent:@""];
        [header setEnabled:NO];
        [dockMenu addItem:header];

        // List each editor window
        for (NSWindow *window in editorWindows) {
            NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:[window title]
                                                          action:@selector(makeKeyAndOrderFront:)
                                                   keyEquivalent:@""];
            [item setTarget:window];
            // Mark the key (frontmost) window with a checkmark
            if ([window isKeyWindow]) {
                [item setState:NSControlStateValueOn];
            }
            [dockMenu addItem:item];
        }

        // Separator + Show All
        [dockMenu addItem:[NSMenuItem separatorItem]];

        NSMenuItem *showAll = [[NSMenuItem alloc] initWithTitle:@"Show All Editor Windows"
                                                         action:@selector(showAllEditorWindows:)
                                                  keyEquivalent:@""];
        [showAll setTarget:self];
        [dockMenu addItem:showAll];
    }

    return dockMenu;
}

// Action: bring all editor windows to front
void showAllEditorWindowsAction(id self, SEL _cmd, id sender) {
    if (editorWindows) {
        for (NSWindow *window in editorWindows) {
            [window makeKeyAndOrderFront:nil];
        }
        [NSApp activateIgnoringOtherApps:YES];
    }
}

// Install the custom Dock menu on Wails' app delegate
void installDockMenu(void) {
    if (dockMenuInstalled) return;

    id delegate = [NSApp delegate];
    if (!delegate) return;

    Class cls = [delegate class];

    // Add applicationDockMenu: → our customDockMenu function
    class_addMethod(cls,
                    @selector(applicationDockMenu:),
                    (IMP)customDockMenu,
                    "@@:@");

    // Add showAllEditorWindows: action
    class_addMethod(cls,
                    @selector(showAllEditorWindows:),
                    (IMP)showAllEditorWindowsAction,
                    "v@:@");

    dockMenuInstalled = YES;
}

// ----------------------------------------------------------
// Create a native macOS editor window
// ----------------------------------------------------------
void openNativeEditorWindow(const char* urlStr, const char* titleStr, int width, int height) {
    // CRITICAL: Copy C strings to NSString SYNCHRONOUSLY before dispatch_async.
    // Go will free the C strings (via defer C.free) right after this function returns.
    NSString *url = [[NSString alloc] initWithUTF8String:urlStr];
    NSString *title = [[NSString alloc] initWithUTF8String:titleStr];
    int w = width;
    int h = height;

    dispatch_async(dispatch_get_main_queue(), ^{
        @autoreleasepool {
            // Initialize static arrays once
            if (!editorWindows) {
                editorWindows = [[NSMutableArray alloc] init];
            }
            if (!editorWindowDelegates) {
                editorWindowDelegates = [[NSMutableArray alloc] init];
            }

            // Install Dock menu on first use
            installDockMenu();

            // Offset new windows slightly so they don't stack exactly on top
            int offset = (int)[editorWindows count] * 26;

            NSRect frame = NSMakeRect(0, 0, w, h);
            NSUInteger styleMask = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable |
                                   NSWindowStyleMaskResizable | NSWindowStyleMaskMiniaturizable;

            NSWindow *window = [[NSWindow alloc] initWithContentRect:frame
                                                 styleMask:styleMask
                                                 backing:NSBackingStoreBuffered
                                                 defer:NO];

            [window setTitle:title];
            [window setMinSize:NSMakeSize(400, 300)];
            [window center];

            // Offset from center if multiple windows
            if (offset > 0) {
                NSRect wFrame = [window frame];
                wFrame.origin.x += offset;
                wFrame.origin.y -= offset;
                [window setFrame:wFrame display:YES];
            }

            // Make the window participate in Spaces, Mission Control, and the app cycle
            [window setCollectionBehavior:NSWindowCollectionBehaviorManaged |
                                          NSWindowCollectionBehaviorParticipatesInCycle];
            [window setExcludedFromWindowsMenu:NO];

            // Set up delegate for cleanup on close
            EditorWindowDelegate *delegate = [[EditorWindowDelegate alloc] init];
            [window setDelegate:delegate];
            [editorWindowDelegates addObject:delegate];

            // Create WKWebView with preferences
            WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
            [config.preferences setValue:@YES forKey:@"developerExtrasEnabled"];
            WKWebView *webView = [[WKWebView alloc] initWithFrame:[[window contentView] bounds]
                                                     configuration:config];
            [webView setAutoresizingMask:(NSViewWidthSizable | NSViewHeightSizable)];

            // Load URL
            NSURL *nsurl = [NSURL URLWithString:url];
            NSURLRequest *request = [NSURLRequest requestWithURL:nsurl];
            [webView loadRequest:request];

            [window setContentView:webView];
            [window makeKeyAndOrderFront:nil];
            [window setReleasedWhenClosed:NO];

            // Keep strong reference so the window is NOT deallocated
            [editorWindows addObject:window];

            // Explicitly add to the app's Window menu (menu bar)
            [NSApp addWindowsItem:window title:title filename:NO];

            // Activate the application (bring to front)
            [NSApp activateIgnoringOtherApps:YES];
        }
    });
}

// ----------------------------------------------------------
// Bring all editor windows to the front
// ----------------------------------------------------------
void bringAllEditorWindowsToFront(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (editorWindows) {
            for (NSWindow *window in editorWindows) {
                [window makeKeyAndOrderFront:nil];
            }
            [NSApp activateIgnoringOtherApps:YES];
        }
    });
}

// ----------------------------------------------------------
// Get the count of open editor windows
// ----------------------------------------------------------
int getEditorWindowCount(void) {
    if (editorWindows) {
        return (int)[editorWindows count];
    }
    return 0;
}
*/
import "C"
import "unsafe"

// OpenNativeWindow opens a native macOS NSWindow with WKWebView loading the given URL.
// The window is fully managed by macOS: appears in Dock menu, Mission Control, and Spaces.
func OpenNativeWindow(url string, title string, width int, height int) {
	cURL := C.CString(url)
	defer C.free(unsafe.Pointer(cURL))
	cTitle := C.CString(title)
	defer C.free(unsafe.Pointer(cTitle))

	C.openNativeEditorWindow(cURL, cTitle, C.int(width), C.int(height))
}

// BringAllEditorWindowsToFront brings all open editor windows to the front.
func BringAllEditorWindowsToFront() {
	C.bringAllEditorWindowsToFront()
}

// GetEditorWindowCount returns the number of open editor windows.
func GetEditorWindowCount() int {
	return int(C.getEditorWindowCount())
}
