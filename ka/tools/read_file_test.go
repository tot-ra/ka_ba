package tools

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func createTestFile(t *testing.T, name string, lines int) string {
	t.Helper()
	content := ""
	for i := 0; i < lines; i++ {
		content += strings.Repeat(string(rune('a'+(i%26))), 5) + "\n"
	}
	tmpFile, err := os.CreateTemp("", name+"_*.txt")
	if err != nil {
		t.Fatalf("Failed to create temp file: %v", err)
	}
	if _, err := tmpFile.Write([]byte(content)); err != nil {
		t.Fatalf("Failed to write to temp file: %v", err)
	}
	if err := tmpFile.Close(); err != nil {
		t.Fatalf("Failed to close temp file: %v", err)
	}
	return tmpFile.Name()
}

func TestReadFileTool_Execute(t *testing.T) {
	ctx := context.Background()
	tool := ReadFileTool{}

	// Test case 1: Read entire small file (less than default 200 lines)
	smallFilePath := createTestFile(t, "small", 10)
	defer os.Remove(smallFilePath)

	argsSmallFile, _ := json.Marshal(map[string]interface{}{"path": smallFilePath})
	fcSmallFile := FunctionCall{Content: string(argsSmallFile)}
	contentSmall, errSmall := tool.Execute(ctx, fcSmallFile)
	if errSmall != nil {
		t.Errorf("Execute failed for small file: %v", errSmall)
	}
	if strings.Count(contentSmall, "\n") != 10 {
		t.Errorf("Expected 10 lines for small file, got %d", strings.Count(contentSmall, "\n"))
	}

	// Test case 2: Read with default FromLine and ToLine (0-200) from a larger file
	largeFilePath := createTestFile(t, "large", 250)
	defer os.Remove(largeFilePath)

	argsDefault, _ := json.Marshal(map[string]interface{}{"path": largeFilePath})
	fcDefault := FunctionCall{Content: string(argsDefault)}
	contentDefault, errDefault := tool.Execute(ctx, fcDefault)
	if errDefault != nil {
		t.Errorf("Execute failed for default range: %v", errDefault)
	}
	if strings.Count(contentDefault, "\n") != 200 {
		t.Errorf("Expected 200 lines for default range, got %d. Content:\n%s", strings.Count(contentDefault, "\n"), contentDefault)
	}
	if !strings.HasPrefix(contentDefault, "aaaaa\n") {
		t.Errorf("Default range content does not start with expected first line")
	}

	// Test case 3: Read specific line range (10-20)
	argsSpecificRange, _ := json.Marshal(map[string]interface{}{"path": largeFilePath, "from_line": 10, "to_line": 20})
	fcSpecificRange := FunctionCall{Content: string(argsSpecificRange)}
	contentSpecific, errSpecific := tool.Execute(ctx, fcSpecificRange)
	if errSpecific != nil {
		t.Errorf("Execute failed for specific range: %v", errSpecific)
	}
	if strings.Count(contentSpecific, "\n") != 10 {
		t.Errorf("Expected 10 lines for specific range 10-20, got %d", strings.Count(contentSpecific, "\n"))
	}
	// Line 10 (0-indexed) should be 'kkkkk'
	if !strings.HasPrefix(contentSpecific, strings.Repeat(string(rune('a'+10)), 5)+"\n") {
		t.Errorf("Specific range content does not start with expected line 10. Got: %s", strings.Split(contentSpecific, "\n")[0])
	}

	// Test case 4: Read with FromLine and ToLine=nil (read to end)
	argsToEnd, _ := json.Marshal(map[string]interface{}{"path": largeFilePath, "from_line": 240, "to_line": nil})
	fcToEnd := FunctionCall{Content: string(argsToEnd)}
	contentToEnd, errToEnd := tool.Execute(ctx, fcToEnd)
	if errToEnd != nil {
		t.Errorf("Execute failed for read to end: %v", errToEnd)
	}
	if strings.Count(contentToEnd, "\n") != 10 { // 250 total lines, from 240 means 240, 241, ..., 249
		t.Errorf("Expected 10 lines for read to end from line 240, got %d", strings.Count(contentToEnd, "\n"))
	}
	// Line 240 (0-indexed) is 'a'+(240%26) = 'a'+6 = 'ggggg'
	if !strings.HasPrefix(contentToEnd, strings.Repeat(string(rune('a'+(240%26))), 5)+"\n") {
		t.Errorf("Read to end content does not start with expected line 240. Got: %s", strings.Split(contentToEnd, "\n")[0])
	}
	
	// Test case 5: Read with FromLine and ToLine beyond file length
	argsBeyond, _ := json.Marshal(map[string]interface{}{"path": smallFilePath, "from_line": 5, "to_line": 15})
	fcBeyond := FunctionCall{Content: string(argsBeyond)}
	contentBeyond, errBeyond := tool.Execute(ctx, fcBeyond)
	if errBeyond != nil {
		t.Errorf("Execute failed for range beyond file length: %v", errBeyond)
	}
	if strings.Count(contentBeyond, "\n") != 5 { // Should read from line 5 to end of file (line 9)
		t.Errorf("Expected 5 lines for range beyond file length, got %d", strings.Count(contentBeyond, "\n"))
	}
	// Line 5 (0-indexed) is 'fffff'
	if !strings.HasPrefix(contentBeyond, strings.Repeat(string(rune('a'+5)), 5)+"\n") {
		t.Errorf("Range beyond file length content does not start with expected line 5. Got: %s", strings.Split(contentBeyond, "\n")[0])
	}

	// Test case 6: FromLine > ToLine (should return empty or error, current impl returns empty for valid FromLine)
	argsFromGtTo, _ := json.Marshal(map[string]interface{}{"path": smallFilePath, "from_line": 5, "to_line": 3})
	fcFromGtTo := FunctionCall{Content: string(argsFromGtTo)}
	contentFromGtTo, errFromGtTo := tool.Execute(ctx, fcFromGtTo)
	if errFromGtTo != nil {
		t.Errorf("Execute failed for FromLine > ToLine: %v", errFromGtTo)
	}
	if contentFromGtTo != "" {
		t.Errorf("Expected empty content for FromLine > ToLine, got: %s", contentFromGtTo)
	}

	// Test case 7: FromLine out of bounds (greater than total lines)
	argsFromOOB, _ := json.Marshal(map[string]interface{}{"path": smallFilePath, "from_line": 15, "to_line": 20})
	fcFromOOB := FunctionCall{Content: string(argsFromOOB)}
	contentFromOOB, errFromOOB := tool.Execute(ctx, fcFromOOB)
	if errFromOOB != nil {
		t.Errorf("Execute failed for FromLine OOB: %v", errFromOOB)
	}
	if contentFromOOB != "" {
		t.Errorf("Expected empty content for FromLine OOB, got: %s", contentFromOOB)
	}
	
	// Test case 8: File not found
	argsNotFound, _ := json.Marshal(map[string]interface{}{"path": filepath.Join("non", "existent", "path.txt")})
	fcNotFound := FunctionCall{Content: string(argsNotFound)}
	_, errNotFound := tool.Execute(ctx, fcNotFound)
	if errNotFound == nil {
		t.Errorf("Expected error for non-existent file, got nil")
	}

	// Test case 9: Empty path
	argsEmptyPath, _ := json.Marshal(map[string]interface{}{"path": ""})
	fcEmptyPath := FunctionCall{Content: string(argsEmptyPath)}
	_, errEmptyPath := tool.Execute(ctx, fcEmptyPath)
	if errEmptyPath == nil {
		t.Errorf("Expected error for empty path, got nil")
	}
	
	// Test case 10: ToLine is exactly the number of lines
	argsToLineExact, _ := json.Marshal(map[string]interface{}{"path": smallFilePath, "from_line": 0, "to_line": 10})
	fcToLineExact := FunctionCall{Content: string(argsToLineExact)}
	contentToLineExact, errToLineExact := tool.Execute(ctx, fcToLineExact)
	if errToLineExact != nil {
		t.Errorf("Execute failed for ToLine exact: %v", errToLineExact)
	}
	if strings.Count(contentToLineExact, "\n") != 10 {
		t.Errorf("Expected 10 lines for ToLine exact, got %d", strings.Count(contentToLineExact, "\n"))
	}

	// Test case 11: from_line = 0, to_line = 0 (should read 0 lines)
	argsZeroRange, _ := json.Marshal(map[string]interface{}{"path": smallFilePath, "from_line": 0, "to_line": 0})
	fcZeroRange := FunctionCall{Content: string(argsZeroRange)}
	contentZeroRange, errZeroRange := tool.Execute(ctx, fcZeroRange)
	if errZeroRange != nil {
		t.Errorf("Execute failed for zero range: %v", errZeroRange)
	}
	if contentZeroRange != "" {
		t.Errorf("Expected empty content for zero range (from 0 to 0), got: %s", contentZeroRange)
	}
	
	// Test case 12: from_line = 5, to_line = 5 (should read 0 lines)
	argsSinglePointRange, _ := json.Marshal(map[string]interface{}{"path": smallFilePath, "from_line": 5, "to_line": 5})
	fcSinglePointRange := FunctionCall{Content: string(argsSinglePointRange)}
	contentSinglePointRange, errSinglePointRange := tool.Execute(ctx, fcSinglePointRange)
	if errSinglePointRange != nil {
		t.Errorf("Execute failed for single point range: %v", errSinglePointRange)
	}
	if contentSinglePointRange != "" {
		t.Errorf("Expected empty content for single point range (from 5 to 5), got: %s", contentSinglePointRange)
	}
}
