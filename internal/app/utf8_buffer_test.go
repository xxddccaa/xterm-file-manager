package app

import (
	"testing"
)

func TestUTF8SafeBuffer_CompleteASCII(t *testing.T) {
	buf := &UTF8SafeBuffer{}

	// Test complete ASCII characters
	result := buf.AppendAndFlush([]byte("Hello World"))
	if result != "Hello World" {
		t.Errorf("Expected 'Hello World', got '%s'", result)
	}
	if len(buf.pending) != 0 {
		t.Errorf("Expected no pending bytes, got %d", len(buf.pending))
	}
}

func TestUTF8SafeBuffer_CompleteChinese(t *testing.T) {
	buf := &UTF8SafeBuffer{}

	// Test complete Chinese characters (3 bytes each)
	// "中文" = E4 B8 AD E6 96 87
	result := buf.AppendAndFlush([]byte("中文"))
	if result != "中文" {
		t.Errorf("Expected '中文', got '%s'", result)
	}
	if len(buf.pending) != 0 {
		t.Errorf("Expected no pending bytes, got %d", len(buf.pending))
	}
}

func TestUTF8SafeBuffer_IncompleteChinese(t *testing.T) {
	buf := &UTF8SafeBuffer{}

	// Test incomplete Chinese character: "中" = E4 B8 AD, send only E4 B8
	result1 := buf.AppendAndFlush([]byte{0xE4, 0xB8})
	if result1 != "" {
		t.Errorf("Expected empty result for incomplete char, got '%s'", result1)
	}
	if len(buf.pending) != 2 {
		t.Errorf("Expected 2 pending bytes, got %d", len(buf.pending))
	}

	// Send the missing byte AD, should complete the character
	result2 := buf.AppendAndFlush([]byte{0xAD})
	if result2 != "中" {
		t.Errorf("Expected '中', got '%s'", result2)
	}
	if len(buf.pending) != 0 {
		t.Errorf("Expected no pending bytes after completion, got %d", len(buf.pending))
	}
}

func TestUTF8SafeBuffer_MixedASCIIAndChinese(t *testing.T) {
	buf := &UTF8SafeBuffer{}

	// Test mixed content: "Hello世界"
	result := buf.AppendAndFlush([]byte("Hello世界"))
	if result != "Hello世界" {
		t.Errorf("Expected 'Hello世界', got '%s'", result)
	}
	if len(buf.pending) != 0 {
		t.Errorf("Expected no pending bytes, got %d", len(buf.pending))
	}
}

func TestUTF8SafeBuffer_IncompleteAtEnd(t *testing.T) {
	buf := &UTF8SafeBuffer{}

	// Test complete ASCII + incomplete Chinese at end
	// "Test" + incomplete "中" (only E4 B8)
	input := append([]byte("Test"), 0xE4, 0xB8)
	result := buf.AppendAndFlush(input)

	if result != "Test" {
		t.Errorf("Expected 'Test', got '%s'", result)
	}
	if len(buf.pending) != 2 {
		t.Errorf("Expected 2 pending bytes, got %d", len(buf.pending))
	}

	// Complete with "中" + "文"
	// AD (completes "中") + E6 96 87 ("文")
	result2 := buf.AppendAndFlush([]byte{0xAD, 0xE6, 0x96, 0x87})
	if result2 != "中文" {
		t.Errorf("Expected '中文', got '%s'", result2)
	}
	if len(buf.pending) != 0 {
		t.Errorf("Expected no pending bytes, got %d", len(buf.pending))
	}
}

func TestUTF8SafeBuffer_Emoji4Bytes(t *testing.T) {
	buf := &UTF8SafeBuffer{}

	// Test 4-byte emoji: "🎉" = F0 9F 8E 89
	result := buf.AppendAndFlush([]byte("🎉"))
	if result != "🎉" {
		t.Errorf("Expected '🎉', got '%s'", result)
	}
	if len(buf.pending) != 0 {
		t.Errorf("Expected no pending bytes, got %d", len(buf.pending))
	}
}

func TestUTF8SafeBuffer_IncompleteEmoji(t *testing.T) {
	buf := &UTF8SafeBuffer{}

	// Test incomplete emoji: "🎉" = F0 9F 8E 89, send only F0 9F 8E
	result1 := buf.AppendAndFlush([]byte{0xF0, 0x9F, 0x8E})
	if result1 != "" {
		t.Errorf("Expected empty result for incomplete emoji, got '%s'", result1)
	}
	if len(buf.pending) != 3 {
		t.Errorf("Expected 3 pending bytes, got %d", len(buf.pending))
	}

	// Complete the emoji
	result2 := buf.AppendAndFlush([]byte{0x89})
	if result2 != "🎉" {
		t.Errorf("Expected '🎉', got '%s'", result2)
	}
	if len(buf.pending) != 0 {
		t.Errorf("Expected no pending bytes, got %d", len(buf.pending))
	}
}

func TestUTF8SafeBuffer_MultipleIncompleteSequences(t *testing.T) {
	buf := &UTF8SafeBuffer{}

	// Simulate multiple reads that split UTF-8 characters
	// "测试中文" = E6 B5 8B E8 AF 95 E4 B8 AD E6 96 87

	// Read 1: E6 B5 (incomplete "测")
	result1 := buf.AppendAndFlush([]byte{0xE6, 0xB5})
	if result1 != "" || len(buf.pending) != 2 {
		t.Errorf("Read 1 failed: result='%s', pending=%d", result1, len(buf.pending))
	}

	// Read 2: 8B E8 AF (completes "测", incomplete "试")
	result2 := buf.AppendAndFlush([]byte{0x8B, 0xE8, 0xAF})
	if result2 != "测" || len(buf.pending) != 2 {
		t.Errorf("Read 2 failed: result='%s', pending=%d", result2, len(buf.pending))
	}

	// Read 3: 95 E4 B8 AD E6 96 (completes "试中", incomplete "文")
	result3 := buf.AppendAndFlush([]byte{0x95, 0xE4, 0xB8, 0xAD, 0xE6, 0x96})
	if result3 != "试中" || len(buf.pending) != 2 {
		t.Errorf("Read 3 failed: result='%s', pending=%d", result3, len(buf.pending))
	}

	// Read 4: 87 (completes "文")
	result4 := buf.AppendAndFlush([]byte{0x87})
	if result4 != "文" || len(buf.pending) != 0 {
		t.Errorf("Read 4 failed: result='%s', pending=%d", result4, len(buf.pending))
	}
}

func TestUTF8SafeBuffer_Flush(t *testing.T) {
	buf := &UTF8SafeBuffer{}

	// Add incomplete data
	buf.AppendAndFlush([]byte{0xE4, 0xB8})
	if len(buf.pending) != 2 {
		t.Errorf("Expected 2 pending bytes, got %d", len(buf.pending))
	}

	// Flush should return all pending bytes
	result := buf.Flush()
	// The result will be invalid UTF-8, but should not be empty
	if len(result) == 0 {
		t.Errorf("Expected non-empty flush result")
	}
	if len(buf.pending) != 0 {
		t.Errorf("Expected no pending bytes after flush, got %d", len(buf.pending))
	}
}

func TestUTF8SafeBuffer_EmptyInput(t *testing.T) {
	buf := &UTF8SafeBuffer{}

	result := buf.AppendAndFlush([]byte{})
	if result != "" {
		t.Errorf("Expected empty result for empty input, got '%s'", result)
	}

	result = buf.AppendAndFlush(nil)
	if result != "" {
		t.Errorf("Expected empty result for nil input, got '%s'", result)
	}
}

func TestUTF8SafeBuffer_LargeData(t *testing.T) {
	buf := &UTF8SafeBuffer{}

	// Test large data with complete UTF-8 characters
	largeData := ""
	for i := 0; i < 1000; i++ {
		largeData += "测试中文🎉"
	}

	result := buf.AppendAndFlush([]byte(largeData))
	if result != largeData {
		t.Errorf("Large data test failed: lengths %d vs %d", len(result), len(largeData))
	}
	if len(buf.pending) != 0 {
		t.Errorf("Expected no pending bytes, got %d", len(buf.pending))
	}
}

func TestFindLastCompleteUTF8Boundary(t *testing.T) {
	tests := []struct {
		name     string
		input    []byte
		expected int
	}{
		{
			name:     "Complete ASCII",
			input:    []byte("Hello"),
			expected: 5,
		},
		{
			name:     "Complete Chinese",
			input:    []byte("中文"), // E4 B8 AD E6 96 87
			expected: 6,
		},
		{
			name:     "Incomplete Chinese (2 bytes)",
			input:    []byte{0xE4, 0xB8}, // Incomplete "中"
			expected: 0,
		},
		{
			name:     "Complete + Incomplete",
			input:    append([]byte("Test"), 0xE4, 0xB8), // "Test" + incomplete "中"
			expected: 4,
		},
		{
			name:     "Complete emoji",
			input:    []byte("🎉"), // F0 9F 8E 89
			expected: 4,
		},
		{
			name:     "Incomplete emoji (3 bytes)",
			input:    []byte{0xF0, 0x9F, 0x8E}, // Incomplete "🎉"
			expected: 0,
		},
		{
			name:     "Mixed complete",
			input:    []byte("Hello世界🎉"),
			expected: len([]byte("Hello世界🎉")),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := findLastCompleteUTF8Boundary(tt.input)
			if result != tt.expected {
				t.Errorf("Expected %d, got %d for input: %v", tt.expected, result, tt.input)
			}
		})
	}
}
