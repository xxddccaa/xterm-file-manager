//go:build darwin

package app

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa

#include <stdlib.h>
#import <Cocoa/Cocoa.h>

// copyFilesToPasteboard writes file URLs to the macOS system pasteboard (clipboard).
// This makes files available for pasting in Finder, Feishu, WeChat, etc.
// paths: C string array of absolute file paths
// count: number of paths
// Returns 0 on success, -1 on error.
int copyFilesToPasteboard(const char** paths, int count) {
    @autoreleasepool {
        if (count <= 0 || paths == NULL) {
            return -1;
        }

        NSMutableArray<NSURL *> *fileURLs = [NSMutableArray arrayWithCapacity:count];
        for (int i = 0; i < count; i++) {
            if (paths[i] == NULL) continue;
            NSString *pathStr = [NSString stringWithUTF8String:paths[i]];
            NSURL *fileURL = [NSURL fileURLWithPath:pathStr];
            if (fileURL) {
                [fileURLs addObject:fileURL];
            }
        }

        if ([fileURLs count] == 0) {
            return -1;
        }

        NSPasteboard *pb = [NSPasteboard generalPasteboard];
        [pb clearContents];

        // writeObjects: with NSURL array — modern NSPasteboard API.
        // This sets both NSPasteboardTypeFileURL and legacy NSFilenamesPboardType,
        // making files available for paste in Finder, Feishu, WeChat, Slack, etc.
        BOOL ok = [pb writeObjects:fileURLs];
        return ok ? 0 : -1;
    }
}
*/
import "C"
import (
	"fmt"
	"unsafe"
)

// copyLocalFilesToSystemClipboard writes local file paths to the macOS system pasteboard.
// After calling this, the user can Cmd+V paste files into Finder, Feishu, etc.
func copyLocalFilesToSystemClipboard(paths []string) error {
	if len(paths) == 0 {
		return fmt.Errorf("no files to copy")
	}

	// Build C string array
	cPaths := make([]*C.char, len(paths))
	for i, p := range paths {
		cPaths[i] = C.CString(p)
	}
	// Free all C strings after the call
	defer func() {
		for _, cp := range cPaths {
			C.free(unsafe.Pointer(cp))
		}
	}()

	result := C.copyFilesToPasteboard(&cPaths[0], C.int(len(paths)))
	if result != 0 {
		return fmt.Errorf("failed to copy files to system clipboard")
	}

	return nil
}
