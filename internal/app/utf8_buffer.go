package app

import (
	"log"
	"unicode/utf8"
)

// UTF8SafeBuffer ensures that only complete UTF-8 characters are sent to the frontend.
// This prevents the "�� " (U+FFFD replacement character) issue when terminal output
// is read at arbitrary byte boundaries, which can split multi-byte UTF-8 characters.
//
// Design:
// 1. Maintains a buffer of incomplete bytes from the previous read
// 2. On each new read, combines pending bytes with new bytes
// 3. Scans backwards to find the last complete UTF-8 character boundary
// 4. Returns complete characters, saves incomplete trailing bytes
//
// Thread safety: NOT thread-safe. Each TerminalSession should have its own instance.
type UTF8SafeBuffer struct {
	pending []byte // Incomplete UTF-8 byte sequence from previous read
}

// MaxPendingBytes is the safety threshold for pending byte accumulation.
// Normal UTF-8 characters are at most 4 bytes, so pending should never exceed this.
// If it does, we force-flush and log a warning (indicates possible encoding corruption).
const MaxPendingBytes = 10

// AppendAndFlush combines new bytes with pending bytes and returns all complete UTF-8 characters.
// Any incomplete trailing bytes are saved for the next call.
//
// Example:
//
//	Input 1: []byte{0xE4, 0xB8}           // Incomplete "中" (missing 3rd byte)
//	Returns: ""                           // Nothing to emit yet
//	Pending: {0xE4, 0xB8}
//
//	Input 2: []byte{0xAD, 0xE6, 0x96, 0x87}  // Complete "中文"
//	Returns: "中文"
//	Pending: {}
func (b *UTF8SafeBuffer) AppendAndFlush(newBytes []byte) string {
	if len(newBytes) == 0 {
		return ""
	}

	// Combine pending bytes with new bytes
	combined := append(b.pending, newBytes...)

	// Safety check: if pending bytes exceed threshold, force flush with warning
	if len(b.pending) > MaxPendingBytes {
		log.Printf("⚠️ [UTF8Buffer] Pending bytes exceeded %d bytes (%d bytes), force flushing (possible encoding corruption)", MaxPendingBytes, len(b.pending))
		b.pending = nil
		// Return as-is (may contain invalid UTF-8, but prevents memory accumulation)
		return string(combined)
	}

	// Find the last complete UTF-8 character boundary
	validUntil := findLastCompleteUTF8Boundary(combined)

	if validUntil == 0 {
		// No complete characters yet, save everything to pending
		b.pending = combined
		log.Printf("🔍 [UTF8Buffer] No complete UTF-8 character found, pending %d bytes", len(b.pending))
		return ""
	}

	// Split into complete and incomplete parts
	completeBytes := combined[:validUntil]
	incompleteBytes := combined[validUntil:]

	// Update pending with incomplete bytes
	if len(incompleteBytes) > 0 {
		b.pending = make([]byte, len(incompleteBytes))
		copy(b.pending, incompleteBytes)
		log.Printf("🔍 [UTF8Buffer] Saved %d incomplete bytes to pending", len(b.pending))
	} else {
		b.pending = nil
	}

	return string(completeBytes)
}

// Flush returns all remaining bytes (even if incomplete) and clears the pending buffer.
// This should be called when a terminal session ends to emit any remaining data.
func (b *UTF8SafeBuffer) Flush() string {
	if len(b.pending) == 0 {
		return ""
	}

	result := string(b.pending)
	b.pending = nil
	log.Printf("🔍 [UTF8Buffer] Flushed %d pending bytes (session ending)", len(result))
	return result
}

// findLastCompleteUTF8Boundary scans backwards from the end of the byte slice
// to find the position after the last complete UTF-8 character.
//
// Returns:
//   - Position (index) after the last complete UTF-8 character
//   - 0 if no complete characters found
//
// Algorithm:
//
//	UTF-8 encoding rules:
//	- 1-byte char: 0xxxxxxx (0x00-0x7F)
//	- 2-byte char: 110xxxxx 10xxxxxx
//	- 3-byte char: 1110xxxx 10xxxxxx 10xxxxxx
//	- 4-byte char: 11110xxx 10xxxxxx 10xxxxxx 10xxxxxx
//
//	Scan backwards to find the start of the last character:
//	- If byte & 0x80 == 0 (0xxxxxxx): Single-byte character, complete
//	- If byte & 0xC0 == 0x80 (10xxxxxx): Continuation byte, keep scanning
//	- If byte & 0xE0 == 0xC0 (110xxxxx): Start of 2-byte character
//	- If byte & 0xF0 == 0xE0 (1110xxxx): Start of 3-byte character
//	- If byte & 0xF8 == 0xF0 (11110xxx): Start of 4-byte character
func findLastCompleteUTF8Boundary(data []byte) int {
	if len(data) == 0 {
		return 0
	}

	// Use Go's built-in UTF-8 validation to scan backwards
	// Start from the end and scan backwards up to 4 bytes (max UTF-8 char size)
	for i := len(data); i > 0; i-- {
		// Try to decode a rune starting at position i
		// If valid, check if it extends to the end of data
		if utf8.RuneStart(data[i-1]) {
			// This byte could be the start of a rune
			r, size := utf8.DecodeRune(data[i-1:])
			if r != utf8.RuneError {
				// Valid rune found
				if i-1+size == len(data) {
					// This rune extends exactly to the end - it's complete
					return len(data)
				} else if i-1+size < len(data) {
					// This rune ends before the end of data
					// Check if there's another complete rune after it
					continue
				} else {
					// This rune would extend beyond the end - it's incomplete
					// Return position before this rune
					return i - 1
				}
			}
		}

		// Special case: if we're within 4 bytes of the end, check if it's a continuation byte
		if len(data)-i < 4 && data[i-1]&0xC0 == 0x80 {
			// This is a continuation byte (10xxxxxx), keep scanning backwards
			continue
		}
	}

	// Fallback: use ValidString to find the last valid position
	for i := len(data); i > 0; i-- {
		if utf8.Valid(data[:i]) {
			return i
		}
	}

	return 0
}
