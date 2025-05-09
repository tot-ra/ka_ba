package tools

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
)

// Helper function to check if ripgrep (rg) is installed
func isRgInstalled() bool {
	_, err := exec.LookPath("rg")
	return err == nil
}

// TestSearchFilesTool_Execute_Success tests a successful search operation.
func TestSearchFilesTool_Execute_Success(t *testing.T) {
	if !isRgInstalled() {
		t.Skip("ripgrep (rg) is not installed. Skipping test.")
	}

	tempDir, err := os.MkdirTemp("", "searchtest")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	filePath := filepath.Join(tempDir, "testfile.txt")
	fileContent := "Hello World\nThis is a test line with foobar.\nAnother line."
	if err := os.WriteFile(filePath, []byte(fileContent), 0644); err != nil {
		t.Fatalf("Failed to write temp file: %v", err)
	}

	tool := &SearchFilesTool{}
	args := SearchFilesArgs{
		Path:  tempDir,
		Regex: "foobar",
	}
	argsJSON, _ := json.Marshal(args)

	callDetails := FunctionCall{
		Name:    "search_files",
		Content: string(argsJSON),
	}

	result, err := tool.Execute(context.Background(), callDetails)
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}

	if result == "" {
		t.Fatalf("Expected non-empty result, got empty string")
	}

	// Expecting JSON output from rg.
	// A minimal check: does it contain the filename and the matched text?
	// rg --json output is a stream of JSON objects, one per line.
	// For a match, it will be type "match".
	// Example: {"type":"match","data":{"path":{"text":"/tmp/searchtest701286037/testfile.txt"},"lines":{"text":"This is a test line with foobar.\n"}, ...}}

	var rgOutputEntries []map[string]interface{}
	decoder := json.NewDecoder(strings.NewReader(result))
	for decoder.More() {
		var entry map[string]interface{}
		if err := decoder.Decode(&entry); err != nil {
			t.Fatalf("Failed to decode rg JSON output entry: %v. Output: %s", err, result)
		}
		rgOutputEntries = append(rgOutputEntries, entry)
	}
	
	foundMatch := false
	for _, entry := range rgOutputEntries {
		if entryType, ok := entry["type"].(string); ok && entryType == "match" {
			if data, ok := entry["data"].(map[string]interface{}); ok {
				if lines, ok := data["lines"].(map[string]interface{}); ok {
					if text, ok := lines["text"].(string); ok && strings.Contains(text, "foobar") {
						foundMatch = true
						break
					}
				}
			}
		}
	}

	if !foundMatch {
		t.Errorf("Expected to find 'foobar' in rg JSON output, but did not. Output: %s", result)
	}
}

// TestSearchFilesTool_Execute_NoMatches tests the case where no matches are found.
func TestSearchFilesTool_Execute_NoMatches(t *testing.T) {
	if !isRgInstalled() {
		t.Skip("ripgrep (rg) is not installed. Skipping test.")
	}

	tempDir, err := os.MkdirTemp("", "searchtest_nomatch")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	filePath := filepath.Join(tempDir, "testfile.txt")
	fileContent := "Hello World\nThis is a test line.\nAnother line."
	if err := os.WriteFile(filePath, []byte(fileContent), 0644); err != nil {
		t.Fatalf("Failed to write temp file: %v", err)
	}

	tool := &SearchFilesTool{}
	args := SearchFilesArgs{
		Path:  tempDir,
		Regex: "nonexistentpattern",
	}
	argsJSON, _ := json.Marshal(args)

	callDetails := FunctionCall{
		Name:    "search_files",
		Content: string(argsJSON),
	}

	result, err := tool.Execute(context.Background(), callDetails)
	if err != nil {
		// rg exits with 1 on no matches, but our tool should not error if stderr is empty.
		t.Fatalf("Execute failed unexpectedly: %v", err)
	}

	// Expecting empty JSON array or similar valid JSON for no matches from rg --json
	if strings.TrimSpace(result) != "" {
		// rg --json with no matches might produce an empty string or just whitespace
		// depending on the rg version or if it outputs begin/end markers.
		// Let's try to unmarshal it. If it's not valid JSON or not an empty array, it's an issue.
		var entries []interface{}
		if jsonErr := json.Unmarshal([]byte(result), &entries); jsonErr != nil {
			// If it's not an array, it might be a stream of begin/end objects.
			// For simplicity, we'll just check if it contains "match" type.
			if strings.Contains(result, `"type":"match"`) {
				t.Errorf("Expected no matches in output, but found 'match' type. Output: %s", result)
			}
		} else if len(entries) > 0 {
			t.Errorf("Expected empty JSON array for no matches, got: %s", result)
		}
	}
}

// TestSearchFilesTool_Execute_WithPathPattern tests using a file pattern.
func TestSearchFilesTool_Execute_WithPathPattern(t *testing.T) {
	if !isRgInstalled() {
		t.Skip("ripgrep (rg) is not installed. Skipping test.")
	}

	tempDir, err := os.MkdirTemp("", "searchtest_pattern")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// File that should match pattern and content
	filePath1 := filepath.Join(tempDir, "file1.log")
	fileContent1 := "Log entry: important_keyword found."
	if err := os.WriteFile(filePath1, []byte(fileContent1), 0644); err != nil {
		t.Fatalf("Failed to write temp file1: %v", err)
	}

	// File that should NOT match pattern
	filePath2 := filepath.Join(tempDir, "file2.txt")
	fileContent2 := "Text file: important_keyword also here."
	if err := os.WriteFile(filePath2, []byte(fileContent2), 0644); err != nil {
		t.Fatalf("Failed to write temp file2: %v", err)
	}
	
	// File that matches pattern but NOT content
	filePath3 := filepath.Join(tempDir, "file3.log")
	fileContent3 := "Log entry: other stuff."
	if err := os.WriteFile(filePath3, []byte(fileContent3), 0644); err != nil {
		t.Fatalf("Failed to write temp file3: %v", err)
	}


	tool := &SearchFilesTool{}
	filePattern := "*.log"
	args := SearchFilesArgs{
		Path:        tempDir,
		Regex:       "important_keyword",
		FilePattern: &filePattern,
	}
	argsJSON, _ := json.Marshal(args)

	callDetails := FunctionCall{
		Name:    "search_files",
		Content: string(argsJSON),
	}

	result, err := tool.Execute(context.Background(), callDetails)
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}

	var rgOutputEntries []map[string]interface{}
	decoder := json.NewDecoder(strings.NewReader(result))
	foundMatchInLogFile := false
	foundMatchInTxtFile := false

	for decoder.More() {
		var entry map[string]interface{}
		if err := decoder.Decode(&entry); err != nil {
			// Allow EOF if result is empty or just whitespace
			if err.Error() == "EOF" && strings.TrimSpace(result) == "" {
				break
			}
			t.Fatalf("Failed to decode rg JSON output entry: %v. Output: %s", err, result)
		}
		rgOutputEntries = append(rgOutputEntries, entry)
	}

	for _, entry := range rgOutputEntries {
		if entryType, ok := entry["type"].(string); ok && entryType == "match" {
			if data, ok := entry["data"].(map[string]interface{}); ok {
				if pathData, ok := data["path"].(map[string]interface{}); ok {
					if pathText, ok := pathData["text"].(string); ok {
						if strings.HasSuffix(pathText, "file1.log") {
							if lines, ok := data["lines"].(map[string]interface{}); ok {
								if text, ok := lines["text"].(string); ok && strings.Contains(text, "important_keyword") {
									foundMatchInLogFile = true
								}
							}
						}
						if strings.HasSuffix(pathText, "file2.txt") {
							foundMatchInTxtFile = true // Should not happen
						}
					}
				}
			}
		}
	}

	if !foundMatchInLogFile {
		t.Errorf("Expected to find 'important_keyword' in 'file1.log', but did not. Output: %s", result)
	}
	if foundMatchInTxtFile {
		t.Errorf("Did not expect to find match in 'file2.txt' due to file pattern, but did. Output: %s", result)
	}
}


// TestSearchFilesTool_Execute_MissingPath tests missing path argument.
func TestSearchFilesTool_Execute_MissingPath(t *testing.T) {
	tool := &SearchFilesTool{}
	args := SearchFilesArgs{ // Path is missing
		Regex: "anyregex",
	}
	argsJSON, _ := json.Marshal(args)
	callDetails := FunctionCall{Content: string(argsJSON)}

	_, err := tool.Execute(context.Background(), callDetails)
	if err == nil {
		t.Fatalf("Expected error for missing path, got nil")
	}
	expectedErrorMsg := "missing required 'path' argument"
	if !strings.Contains(err.Error(), expectedErrorMsg) {
		t.Errorf("Expected error message to contain '%s', got '%s'", expectedErrorMsg, err.Error())
	}
}

// TestSearchFilesTool_Execute_MissingRegex tests missing regex argument.
func TestSearchFilesTool_Execute_MissingRegex(t *testing.T) {
	tool := &SearchFilesTool{}
	args := SearchFilesArgs{ // Regex is missing
		Path: "./dummy_path",
	}
	argsJSON, _ := json.Marshal(args)
	callDetails := FunctionCall{Content: string(argsJSON)}

	_, err := tool.Execute(context.Background(), callDetails)
	if err == nil {
		t.Fatalf("Expected error for missing regex, got nil")
	}
	expectedErrorMsg := "missing required 'regex' argument"
	if !strings.Contains(err.Error(), expectedErrorMsg) {
		t.Errorf("Expected error message to contain '%s', got '%s'", expectedErrorMsg, err.Error())
	}
}

// TestSearchFilesTool_Execute_InvalidJSON tests invalid JSON input.
func TestSearchFilesTool_Execute_InvalidJSON(t *testing.T) {
	tool := &SearchFilesTool{}
	invalidJSON := `{"path": "/tmp", "regex": "test",` // Malformed JSON
	callDetails := FunctionCall{Content: invalidJSON}

	_, err := tool.Execute(context.Background(), callDetails)
	if err == nil {
		t.Fatalf("Expected error for invalid JSON, got nil")
	}
	if !strings.Contains(err.Error(), "failed to parse arguments JSON") {
		t.Errorf("Expected error due to JSON parsing, got: %v", err)
	}
}

// TestSearchFilesTool_Getters tests the getter methods.
func TestSearchFilesTool_Getters(t *testing.T) {
	tool := &SearchFilesTool{}
	if name := tool.GetName(); name != "search_files" {
		t.Errorf("Expected GetName() to be 'search_files', got '%s'", name)
	}
	if desc := tool.GetDescription(); desc == "" {
		t.Errorf("Expected GetDescription() to be non-empty, got empty string")
	}
	if xmlDef := tool.GetXMLDefinition(); !strings.Contains(xmlDef, "<tool id=\"search_files\">") {
		t.Errorf("Expected GetXMLDefinition() to contain '<tool id=\"search_files\">', got '%s'", xmlDef)
	}
}
