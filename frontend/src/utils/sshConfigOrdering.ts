export interface SSHConfigLike {
  host: string
}

export interface SSHConfigBlock {
  aliases: string[]
  text: string
}

export interface ParsedSSHConfigBlocks {
  prefix: string
  blocks: SSHConfigBlock[]
}

export interface ReorderSSHConfigResult {
  content: string
  changed: boolean
  matchedBlockCount: number
}

const HOST_DIRECTIVE_RE = /^Host(?:\s+|=)/i

const splitLinesPreservingNewlines = (content: string): string[] => {
  return content.match(/[^\n]*\n|[^\n]+/g) ?? []
}

const shouldListSSHAlias = (alias: string): boolean => {
  const value = alias.trim()
  if (!value || value === '*' || value.startsWith('!')) {
    return false
  }
  return !/[?*]/.test(value)
}

const stripInlineSSHComment = (line: string): string => {
  let inQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"') {
      inQuotes = !inQuotes
      continue
    }

    if (char === '#' && !inQuotes) {
      return line.slice(0, index).trim()
    }
  }

  return line.trim()
}

const isHostDirectiveLine = (line: string): boolean => {
  const trimmed = line.trimStart()
  if (!trimmed || trimmed.startsWith('#')) {
    return false
  }

  return HOST_DIRECTIVE_RE.test(trimmed)
}

const extractHostAliases = (line: string): string[] => {
  const match = stripInlineSSHComment(line).match(/^\s*Host(?:\s+|=)(.+)$/i)
  if (!match) {
    return []
  }

  return match[1]
    .split(/\s+/)
    .map((alias) => alias.trim())
    .filter(shouldListSSHAlias)
}

export const parseSSHConfigBlocks = (content: string): ParsedSSHConfigBlocks => {
  const lines = splitLinesPreservingNewlines(content)
  const blocks: SSHConfigBlock[] = []
  const prefixLines: string[] = []

  let currentBlockLines: string[] | null = null
  let currentAliases: string[] = []

  const flushCurrentBlock = () => {
    if (!currentBlockLines) {
      return
    }

    blocks.push({
      aliases: currentAliases,
      text: currentBlockLines.join(''),
    })
    currentBlockLines = null
    currentAliases = []
  }

  lines.forEach((line) => {
    if (isHostDirectiveLine(line)) {
      flushCurrentBlock()
      currentBlockLines = [line]
      currentAliases = extractHostAliases(line)
      return
    }

    if (currentBlockLines) {
      currentBlockLines.push(line)
      return
    }

    prefixLines.push(line)
  })

  flushCurrentBlock()

  return {
    prefix: prefixLines.join(''),
    blocks,
  }
}

export const reorderSSHConfigContent = (
  content: string,
  orderedHosts: string[],
): ReorderSSHConfigResult => {
  const parsed = parseSSHConfigBlocks(content)
  if (parsed.blocks.length < 2) {
    return {
      content,
      changed: false,
      matchedBlockCount: parsed.blocks.filter((block) => block.aliases.length > 0).length,
    }
  }

  const targetIndexByHost = new Map<string, number>()
  orderedHosts.forEach((host, index) => {
    if (!targetIndexByHost.has(host)) {
      targetIndexByHost.set(host, index)
    }
  })

  const annotatedBlocks = parsed.blocks.map((block, originalIndex) => {
    let targetIndex = Number.POSITIVE_INFINITY
    block.aliases.forEach((alias) => {
      const nextIndex = targetIndexByHost.get(alias)
      if (nextIndex !== undefined && nextIndex < targetIndex) {
        targetIndex = nextIndex
      }
    })

    return {
      block,
      originalIndex,
      targetIndex,
    }
  })

  const matchedBlockCount = annotatedBlocks.filter((block) => Number.isFinite(block.targetIndex)).length
  const reorderedBlocks = [...annotatedBlocks].sort((left, right) => {
    if (left.targetIndex === right.targetIndex) {
      return left.originalIndex - right.originalIndex
    }
    return left.targetIndex - right.targetIndex
  })

  const changed = reorderedBlocks.some((block, index) => block.originalIndex !== index)
  if (!changed) {
    return {
      content,
      changed: false,
      matchedBlockCount,
    }
  }

  return {
    content: parsed.prefix + reorderedBlocks.map((block) => block.block.text).join(''),
    changed: true,
    matchedBlockCount,
  }
}

const moveArrayItem = <T,>(items: T[], fromIndex: number, toIndex: number): T[] => {
  if (fromIndex === toIndex) {
    return items
  }

  const nextItems = [...items]
  const [movedItem] = nextItems.splice(fromIndex, 1)
  nextItems.splice(toIndex, 0, movedItem)
  return nextItems
}

export const reorderSSHConfigsByVisibleHosts = <T extends SSHConfigLike>(
  configs: T[],
  draggedHost: string,
  targetHost: string,
  visibleHosts: string[],
): T[] => {
  const visibleHostSet = new Set(visibleHosts)
  const visibleConfigs = configs.filter((config) => visibleHostSet.has(config.host))
  const fromIndex = visibleConfigs.findIndex((config) => config.host === draggedHost)
  const toIndex = visibleConfigs.findIndex((config) => config.host === targetHost)

  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return configs
  }

  const reorderedVisible = moveArrayItem(visibleConfigs, fromIndex, toIndex)
  let visibleIndex = 0

  return configs.map((config) => {
    if (!visibleHostSet.has(config.host)) {
      return config
    }

    const nextConfig = reorderedVisible[visibleIndex]
    visibleIndex += 1
    return nextConfig
  })
}

export const sortSSHConfigsByName = <T extends SSHConfigLike>(
  configs: T[],
  direction: 'asc' | 'desc',
): T[] => {
  const multiplier = direction === 'asc' ? 1 : -1

  return configs
    .map((config, index) => ({ config, index }))
    .sort((left, right) => {
      const order = left.config.host.localeCompare(right.config.host, undefined, {
        numeric: true,
        sensitivity: 'base',
      })

      if (order !== 0) {
        return order * multiplier
      }

      return left.index - right.index
    })
    .map((entry) => entry.config)
}

export const haveSameSSHConfigOrder = <T extends SSHConfigLike>(
  left: T[],
  right: T[],
): boolean => {
  if (left.length !== right.length) {
    return false
  }

  return left.every((config, index) => config.host === right[index]?.host)
}
