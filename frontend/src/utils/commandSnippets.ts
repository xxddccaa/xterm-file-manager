export interface CommandSnippet {
  id: string
  title: string
  command: string
  description: string
  tags?: string[]
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

const normalize = (value: string): string => value.trim().toLowerCase()

const fuzzySubsequenceScore = (query: string, target: string): number => {
  let queryIndex = 0
  let firstMatch = -1
  let lastMatch = -1

  for (let index = 0; index < target.length && queryIndex < query.length; index += 1) {
    if (target[index] !== query[queryIndex]) {
      continue
    }

    if (firstMatch === -1) {
      firstMatch = index
    }
    lastMatch = index
    queryIndex += 1
  }

  if (queryIndex !== query.length || firstMatch === -1 || lastMatch === -1) {
    return -1
  }

  const span = lastMatch - firstMatch + 1
  return Math.max(1, 40 - (span - query.length) - firstMatch)
}

const scoreToken = (token: string, snippet: CommandSnippet): number => {
  const searchableFields = [
    { text: normalize(snippet.title), weight: 130 },
    { text: normalize(snippet.command), weight: 115 },
    { text: normalize((snippet.tags || []).join(' ')), weight: 100 },
    { text: normalize(snippet.description), weight: 85 },
  ]

  let bestScore = -1
  searchableFields.forEach(({ text, weight }) => {
    if (!text) {
      return
    }

    const matchIndex = text.indexOf(token)
    if (matchIndex >= 0) {
      bestScore = Math.max(bestScore, weight - Math.min(matchIndex, 30))
      return
    }

    const fuzzyScore = fuzzySubsequenceScore(token, text)
    if (fuzzyScore >= 0) {
      bestScore = Math.max(bestScore, weight - 60 + fuzzyScore)
    }
  })

  return bestScore
}

export const filterCommandSnippets = (
  snippets: CommandSnippet[],
  query: string,
): CommandSnippet[] => {
  const normalizedQuery = normalize(query)
  if (!normalizedQuery) {
    return snippets
  }

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean)
  if (tokens.length === 0) {
    return snippets
  }

  return snippets
    .map((snippet, index) => {
      let totalScore = 0
      for (const token of tokens) {
        const tokenScore = scoreToken(token, snippet)
        if (tokenScore < 0) {
          return null
        }
        totalScore += tokenScore
      }

      return {
        snippet,
        totalScore,
        index,
      }
    })
    .filter((entry): entry is { snippet: CommandSnippet; totalScore: number; index: number } => entry !== null)
    .sort((left, right) => {
      if (right.totalScore !== left.totalScore) {
        return right.totalScore - left.totalScore
      }
      return left.index - right.index
    })
    .map((entry) => entry.snippet)
}

export const reorderCommandSnippetsByVisibleIds = (
  snippets: CommandSnippet[],
  draggedId: string,
  targetId: string,
  visibleIds: string[],
): CommandSnippet[] => {
  const visibleIdSet = new Set(visibleIds)
  const visibleSnippets = snippets.filter((snippet) => visibleIdSet.has(snippet.id))
  const fromIndex = visibleSnippets.findIndex((snippet) => snippet.id === draggedId)
  const toIndex = visibleSnippets.findIndex((snippet) => snippet.id === targetId)

  if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
    return snippets
  }

  const reorderedVisible = moveArrayItem(visibleSnippets, fromIndex, toIndex)
  let visibleIndex = 0

  return snippets.map((snippet) => {
    if (!visibleIdSet.has(snippet.id)) {
      return snippet
    }

    const nextSnippet = reorderedVisible[visibleIndex]
    visibleIndex += 1
    return nextSnippet
  })
}
