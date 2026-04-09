package app

import (
	"path/filepath"
	"strings"
)

type parsedSSHConfigBlocks struct {
	prefix string
	blocks []string
}

func isSSHConfigPath(originalPath string, resolvedPath string) bool {
	return originalPath == "~/.ssh/config" ||
		(filepath.Base(resolvedPath) == "config" && filepath.Base(filepath.Dir(resolvedPath)) == ".ssh")
}

func formatSSHConfigSpacing(content string) string {
	parsed := parseSSHConfigBlocks(content)
	if len(parsed.blocks) == 0 {
		return content
	}

	hadTrailingNewline := strings.HasSuffix(content, "\n")
	formattedBlocks := make([]string, 0, len(parsed.blocks))
	for _, block := range parsed.blocks {
		formattedBlocks = append(formattedBlocks, trimOuterBlankLines(block))
	}

	formatted := parsed.prefix + strings.Join(formattedBlocks, "\n\n")
	if hadTrailingNewline && formatted != "" && !strings.HasSuffix(formatted, "\n") {
		formatted += "\n"
	}

	return formatted
}

func parseSSHConfigBlocks(content string) parsedSSHConfigBlocks {
	lines := splitLinesPreservingNewlines(content)
	blocks := make([]string, 0)
	prefixLines := make([]string, 0)

	var currentBlockLines []string
	flushCurrentBlock := func() {
		if currentBlockLines == nil {
			return
		}
		blocks = append(blocks, strings.Join(currentBlockLines, ""))
		currentBlockLines = nil
	}

	for _, line := range lines {
		if isSSHHostDirectiveLine(line) {
			flushCurrentBlock()
			currentBlockLines = []string{line}
			continue
		}

		if currentBlockLines != nil {
			currentBlockLines = append(currentBlockLines, line)
			continue
		}

		prefixLines = append(prefixLines, line)
	}

	flushCurrentBlock()

	return parsedSSHConfigBlocks{
		prefix: strings.Join(prefixLines, ""),
		blocks: blocks,
	}
}

func splitLinesPreservingNewlines(content string) []string {
	if content == "" {
		return nil
	}

	lines := strings.SplitAfter(content, "\n")
	if lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

func isSSHHostDirectiveLine(line string) bool {
	trimmed := strings.TrimLeft(line, " \t")
	if trimmed == "" || strings.HasPrefix(trimmed, "#") {
		return false
	}

	lowerTrimmed := strings.ToLower(trimmed)
	return strings.HasPrefix(lowerTrimmed, "host ") ||
		strings.HasPrefix(lowerTrimmed, "host\t") ||
		strings.HasPrefix(lowerTrimmed, "host=")
}

func trimOuterBlankLines(content string) string {
	lines := splitLinesPreservingNewlines(content)
	start := 0
	end := len(lines)

	for start < end && strings.TrimSpace(lines[start]) == "" {
		start += 1
	}
	for end > start && strings.TrimSpace(lines[end-1]) == "" {
		end -= 1
	}

	return strings.TrimRight(strings.Join(lines[start:end], ""), "\r\n")
}
