/**
 * Shared in-memory drag state.
 *
 * Wails on macOS sets DisableWebViewDrop:true which causes the native
 * WKWebView to intercept ALL drop operations.  The JavaScript 'drop' event
 * NEVER fires — only 'dragend' fires when the user releases the mouse.
 *
 * Strategy:
 *   1. dragStart  → setDragPayload() stores the source + path.
 *   2. dragover   → setDragTarget() records which zone the cursor is over.
 *   3. dragend    → a single window-level listener reads payload + target
 *                   and dispatches the appropriate action (write to terminal,
 *                   upload, or download).
 *
 * This is a plain module-level variable — no React state, no re-renders.
 */

export interface DragPayload {
  /** 'local' for LocalFileManager, 'remote' for FileManager */
  source: 'local' | 'remote'
  /** Absolute file path */
  path: string
}

/** Where the cursor was last hovering during the drag */
export type DragTarget = 'terminal' | 'local-fm' | 'remote-fm' | null

let currentDrag: DragPayload | null = null
let currentTarget: DragTarget = null

export function setDragPayload(payload: DragPayload): void {
  currentDrag = payload
}

export function getDragPayload(): DragPayload | null {
  return currentDrag
}

export function clearDragPayload(): void {
  currentDrag = null
}

export function setDragTarget(target: DragTarget): void {
  currentTarget = target
}

export function getDragTarget(): DragTarget {
  return currentTarget
}

export function clearDragTarget(): void {
  currentTarget = null
}
