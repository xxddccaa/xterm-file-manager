export const TERMINAL_COPY_CACHE_MS = 3000

interface ResolveTerminalCopyTextOptions {
  isActive: boolean
  currentSelection: string
  hasTerminalSelection: boolean
  cachedSelection: string
  cachedSelectionAgeMs: number
  hasExternalDomSelection?: boolean
  isEditableTarget?: boolean
}

export const resolveTerminalCopyText = ({
  isActive,
  currentSelection,
  hasTerminalSelection,
  cachedSelection,
  cachedSelectionAgeMs,
  hasExternalDomSelection = false,
  isEditableTarget = false,
}: ResolveTerminalCopyTextOptions): string | null => {
  if (!isActive) {
    return null
  }

  if (currentSelection) {
    return currentSelection
  }

  if (hasTerminalSelection && cachedSelection) {
    return cachedSelection
  }

  if (hasExternalDomSelection || isEditableTarget) {
    return null
  }

  if (cachedSelection && cachedSelectionAgeMs <= TERMINAL_COPY_CACHE_MS) {
    return cachedSelection
  }

  return null
}
