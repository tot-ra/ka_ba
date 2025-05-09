package tools

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// Helper function to check if ripgrep (rg) is installed
func isRgInstalled() bool {
	_, err := exec.LookPath("rg")
	return err == nil
}

// Helper to count unique files from rg --json output string
func countUniqueFilesFromRgJSON(t *testing.T, jsonOutput string) int {
	if strings.TrimSpace(jsonOutput) == "" {
		return 0
	}
	filePaths := make(map[string]bool)
	decoder := json.NewDecoder(strings.NewReader(jsonOutput))
	for decoder.More() {
		var entry map[string]interface{}
		if err := decoder.Decode(&entry); err != nil {
			// Allow EOF if the remaining string is just whitespace
			if err.Error() == "EOF" && strings.TrimSpace(jsonOutput[int(decoder.InputOffset()):]) == "" {
				break
			}
			t.Logf("Warning: Failed to decode rg JSON output entry while counting files: %v. Output: %s", err, jsonOutput)
			continue // Try to continue if possible, or fail the test if critical
		}
		entryType, _ := entry["type"].(string)
		if data, ok := entry["data"].(map[string]interface{}); ok {
			if pathData, ok := data["path"].(map[string]interface{}); ok {
				if pathText, ok := pathData["text"].(string); ok {
					if entryType == "begin" || entryType == "match" {
						filePaths[pathText] = true
					}
				}
			}
		}
	}
	return len(filePaths)
}

// Helper to get file paths from rg --json output string
func getFilePathsFromRgJSON(t *testing.T, jsonOutput string) []string {
    if strings.TrimSpace(jsonOutput) == "" {
        return []string{}
    }
    filePathSet := make(map[string]bool)
    var orderedFilePaths []string // Keep order of first appearance for this helper
    decoder := json.NewDecoder(strings.NewReader(jsonOutput))

    for decoder.More() {
        var entry map[string]interface{}
        if err := decoder.Decode(&entry); err != nil {
            if err.Error() == "EOF" && strings.TrimSpace(jsonOutput[int(decoder.InputOffset()):]) == "" {
                break
            }
            t.Logf("Warning: Failed to decode rg JSON output entry while getting file paths: %v. Output: %s", err, jsonOutput)
            continue
        }

        entryType, _ := entry["type"].(string)
        if data, ok := entry["data"].(map[string]interface{}); ok {
            if pathData, ok := data["path"].(map[string]interface{}); ok {
                if pathText, ok := pathData["text"].(string); ok {
                    if entryType == "begin" || entryType == "match" {
                        if !filePathSet[pathText] {
                            filePathSet[pathText] = true
                            orderedFilePaths = append(orderedFilePaths, pathText)
                        }
                    }
                }
            }
        }
    }
    // The tool itself sorts alphabetically for pagination, so we do too for comparison.
    sort.Strings(orderedFilePaths)
    return orderedFilePaths
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
		t.Fatalf("Execute failed unexpectedly: %v", err)
	}

	if strings.TrimSpace(result) != "" {
		var entries []interface{}
		if jsonErr := json.Unmarshal([]byte(result), &entries); jsonErr != nil {
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

	filePath1 := filepath.Join(tempDir, "file1.log") // Should match
	fileContent1 := "Log entry: important_keyword found."
	if err := os.WriteFile(filePath1, []byte(fileContent1), 0644); err != nil {
		t.Fatalf("Failed to write temp file1: %v", err)
	}

	filePath2 := filepath.Join(tempDir, "file2.txt") // Should NOT match pattern
	fileContent2 := "Text file: important_keyword also here."
	if err := os.WriteFile(filePath2, []byte(fileContent2), 0644); err != nil {
		t.Fatalf("Failed to write temp file2: %v", err)
	}
	
	filePath3 := filepath.Join(tempDir, "file3.log") // Matches pattern, not content
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
	callDetails := FunctionCall{Name: "search_files", Content: string(argsJSON)}

	result, err := tool.Execute(context.Background(), callDetails)
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}

	foundMatchInLogFile := false
	foundMatchInTxtFile := false
	decoder := json.NewDecoder(strings.NewReader(result))
	for decoder.More() {
		var entry map[string]interface{}
		if err := decoder.Decode(&entry); err != nil {
			if err.Error() == "EOF" && strings.TrimSpace(result[int(decoder.InputOffset()):]) == "" { break }
			t.Fatalf("Failed to decode rg JSON output entry: %v. Output: %s", err, result)
		}
		if entryType, ok := entry["type"].(string); ok && entryType == "match" {
			if data, ok := entry["data"].(map[string]interface{}); ok {
				if pathData, ok := data["path"].(map[string]interface{}); ok {
					if pathText, ok := pathData["text"].(string); ok {
						if strings.HasSuffix(pathText, "file1.log") {
							foundMatchInLogFile = true
						}
						if strings.HasSuffix(pathText, "file2.txt") {
							foundMatchInTxtFile = true 
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
	args := SearchFilesArgs{Regex: "anyregex"}
	argsJSON, _ := json.Marshal(args)
	callDetails := FunctionCall{Content: string(argsJSON)}
	_, err := tool.Execute(context.Background(), callDetails)
	if err == nil || !strings.Contains(err.Error(), "missing required 'path' argument") {
		t.Fatalf("Expected error for missing path, got: %v", err)
	}
}

// TestSearchFilesTool_Execute_MissingRegex tests missing regex argument.
func TestSearchFilesTool_Execute_MissingRegex(t *testing.T) {
	tool := &SearchFilesTool{}
	args := SearchFilesArgs{Path: "./dummy_path"}
	argsJSON, _ := json.Marshal(args)
	callDetails := FunctionCall{Content: string(argsJSON)}
	_, err := tool.Execute(context.Background(), callDetails)
	if err == nil || !strings.Contains(err.Error(), "missing required 'regex' argument") {
		t.Fatalf("Expected error for missing regex, got: %v", err)
	}
}

// TestSearchFilesTool_Execute_InvalidJSON tests invalid JSON input.
func TestSearchFilesTool_Execute_InvalidJSON(t *testing.T) {
	tool := &SearchFilesTool{}
	invalidJSON := `{"path": "/tmp", "regex": "test",` 
	callDetails := FunctionCall{Content: invalidJSON}
	_, err := tool.Execute(context.Background(), callDetails)
	if err == nil || !strings.Contains(err.Error(), "failed to parse arguments JSON") {
		t.Fatalf("Expected error due to JSON parsing, got: %v", err)
	}
}

// TestSearchFilesTool_Getters tests the getter methods.
func TestSearchFilesTool_Getters(t *testing.T) {
	tool := &SearchFilesTool{}
	if name := tool.GetName(); name != "search_files" {
		t.Errorf("Expected GetName() to be 'search_files', got '%s'", name)
	}
	if desc := tool.GetDescription(); desc == "" { // Basic check
		t.Errorf("Expected GetDescription() to be non-empty")
	}
	// Update expectedXML to match the actual definition in search_files.go
	expectedXML := `<tool id="search_files">{"path": "path/to/directory", "regex": "your_regex_pattern (e.g., \\\\.log$ to find .log files)", "file_pattern": "*.go" (optional), "max_files": 100 (optional), "file_offset": 0 (optional)}</tool>`
	if xmlDef := tool.GetXMLDefinition(); xmlDef != expectedXML {
		t.Errorf("Expected GetXMLDefinition() to be '%s', got '%s'", expectedXML, xmlDef)
	}
}

// --- Pagination Tests ---

// TestSearchFilesTool_Pagination_MaxFiles_LessThanTotal
func TestSearchFilesTool_Pagination_MaxFiles_LessThanTotal(t *testing.T) {
	if !isRgInstalled() { t.Skip("rg not installed") }
	tempDir, _ := os.MkdirTemp("", "pagination_max_less")
	defer os.RemoveAll(tempDir)
	
	// Create 5 files that will match the regex "keyword"
	// file00.txt (keyword), file01.txt, file02.txt (keyword), file03.txt, file04.txt (keyword)
	// Expected matching files (sorted): file00.txt, file02.txt, file04.txt
	if err := os.WriteFile(filepath.Join(tempDir, "file00.txt"), []byte("keyword here"), 0644); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(tempDir, "file01.txt"), []byte("no match"), 0644); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(tempDir, "file02.txt"), []byte("another keyword"), 0644); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(tempDir, "file03.txt"), []byte("nothing"), 0644); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(tempDir, "file04.txt"), []byte("keyword again"), 0644); err != nil { t.Fatal(err) }


	tool := &SearchFilesTool{}
	maxFiles := 2
	args := SearchFilesArgs{Path: tempDir, Regex: "keyword", MaxFiles: &maxFiles}
	argsJSON, _ := json.Marshal(args)
	callDetails := FunctionCall{Content: string(argsJSON)}

	result, err := tool.Execute(context.Background(), callDetails)
	if err != nil { t.Fatalf("Execute failed: %v", err) }

	numResultFiles := countUniqueFilesFromRgJSON(t, result)
	if numResultFiles != 2 {
		t.Errorf("Expected %d files with MaxFiles=%d, got %d. Output: %s", 2, maxFiles, numResultFiles, result)
	}
    
    // Check if the correct files are returned (file00.txt, file02.txt)
    returnedPaths := getFilePathsFromRgJSON(t, result)
    expectedPaths := []string{filepath.Join(tempDir, "file00.txt"), filepath.Join(tempDir, "file02.txt")}
    sort.Strings(expectedPaths) // Ensure test comparison is sorted

    if len(returnedPaths) != len(expectedPaths) {
        t.Fatalf("Expected %d paths, got %d. Returned: %v, Expected: %v", len(expectedPaths), len(returnedPaths), returnedPaths, expectedPaths)
    }
    for i := range returnedPaths {
        if returnedPaths[i] != expectedPaths[i] {
            t.Errorf("Path mismatch at index %d. Got %s, expected %s", i, returnedPaths[i], expectedPaths[i])
        }
    }
}

// TestSearchFilesTool_Pagination_Offset
func TestSearchFilesTool_Pagination_Offset(t *testing.T) {
	if !isRgInstalled() { t.Skip("rg not installed") }
	tempDir, _ := os.MkdirTemp("", "pagination_offset")
	defer os.RemoveAll(tempDir)

	// file00.txt (keyword), file01.txt, file02.txt (keyword), file03.txt, file04.txt (keyword)
	// Expected matching files (sorted): file00.txt, file02.txt, file04.txt
	if err := os.WriteFile(filepath.Join(tempDir, "file00.txt"), []byte("keyword here"), 0644); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(tempDir, "file01.txt"), []byte("no match"), 0644); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(tempDir, "file02.txt"), []byte("another keyword"), 0644); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(tempDir, "file03.txt"), []byte("nothing"), 0644); err != nil { t.Fatal(err) }
	if err := os.WriteFile(filepath.Join(tempDir, "file04.txt"), []byte("keyword again"), 0644); err != nil { t.Fatal(err) }

	tool := &SearchFilesTool{}
	offset := 1
	maxFiles := 2 // Should get file02.txt, file04.txt
	args := SearchFilesArgs{Path: tempDir, Regex: "keyword", FileOffset: &offset, MaxFiles: &maxFiles}
	argsJSON, _ := json.Marshal(args)
	callDetails := FunctionCall{Content: string(argsJSON)}

	result, err := tool.Execute(context.Background(), callDetails)
	if err != nil { t.Fatalf("Execute failed: %v", err) }

	numResultFiles := countUniqueFilesFromRgJSON(t, result)
	if numResultFiles != 2 { // We expect 2 files: file02.txt, file04.txt
		t.Errorf("Expected 2 files with offset=%d, MaxFiles=%d, got %d. Output: %s", offset, maxFiles, numResultFiles, result)
	}

    returnedPaths := getFilePathsFromRgJSON(t, result)
    expectedPaths := []string{filepath.Join(tempDir, "file02.txt"), filepath.Join(tempDir, "file04.txt")}
    sort.Strings(expectedPaths)

    if len(returnedPaths) != len(expectedPaths) {
        t.Fatalf("Expected %d paths, got %d. Returned: %v, Expected: %v", len(expectedPaths), len(returnedPaths), returnedPaths, expectedPaths)
    }
    for i := range returnedPaths {
        if returnedPaths[i] != expectedPaths[i] {
            t.Errorf("Path mismatch at index %d. Got %s, expected %s", i, returnedPaths[i], expectedPaths[i])
        }
    }
}

// TestSearchFilesTool_Pagination_Offset_BeyondTotal
func TestSearchFilesTool_Pagination_Offset_BeyondTotal(t *testing.T) {
	if !isRgInstalled() { t.Skip("rg not installed") }
	tempDir, _ := os.MkdirTemp("", "pagination_offset_beyond")
	defer os.RemoveAll(tempDir)
	if err := os.WriteFile(filepath.Join(tempDir, "file00.txt"), []byte("keyword here"), 0644); err != nil { t.Fatal(err) }

	tool := &SearchFilesTool{}
	offset := 5 // Total matching files is 1
	args := SearchFilesArgs{Path: tempDir, Regex: "keyword", FileOffset: &offset}
	argsJSON, _ := json.Marshal(args)
	callDetails := FunctionCall{Content: string(argsJSON)}

	result, err := tool.Execute(context.Background(), callDetails)
	if err != nil { t.Fatalf("Execute failed: %v", err) }
	if strings.TrimSpace(result) != "" {
		t.Errorf("Expected empty result for offset beyond total, got: %s", result)
	}
}

// TestSearchFilesTool_Pagination_NoParams_ReturnsAll
func TestSearchFilesTool_Pagination_NoParams_ReturnsAll(t *testing.T) {
    if !isRgInstalled() { t.Skip("rg not installed") }
    tempDir, _ := os.MkdirTemp("", "pagination_noparams")
    defer os.RemoveAll(tempDir)

    if err := os.WriteFile(filepath.Join(tempDir, "fileA.txt"), []byte("findme"), 0644); err != nil { t.Fatal(err) }
    if err := os.WriteFile(filepath.Join(tempDir, "fileB.txt"), []byte("findme too"), 0644); err != nil { t.Fatal(err) }

    tool := &SearchFilesTool{}
    args := SearchFilesArgs{Path: tempDir, Regex: "findme"} // No pagination params
    argsJSON, _ := json.Marshal(args)
    callDetails := FunctionCall{Content: string(argsJSON)}

    result, err := tool.Execute(context.Background(), callDetails)
    if err != nil { t.Fatalf("Execute failed: %v", err) }

    numResultFiles := countUniqueFilesFromRgJSON(t, result)
    if numResultFiles != 2 {
        t.Errorf("Expected 2 files when no pagination params, got %d. Output: %s", numResultFiles, result)
    }
}

// TestSearchFilesTool_Pagination_MaxFiles_Zero
func TestSearchFilesTool_Pagination_MaxFiles_Zero(t *testing.T) {
    if !isRgInstalled() { t.Skip("rg not installed") }
    tempDir, _ := os.MkdirTemp("", "pagination_max_zero")
    defer os.RemoveAll(tempDir)
    if err := os.WriteFile(filepath.Join(tempDir, "file00.txt"), []byte("keyword here"), 0644); err != nil { t.Fatal(err) }

    tool := &SearchFilesTool{}
    maxFiles := 0
    args := SearchFilesArgs{Path: tempDir, Regex: "keyword", MaxFiles: &maxFiles}
    argsJSON, _ := json.Marshal(args)
    callDetails := FunctionCall{Content: string(argsJSON)}

    result, err := tool.Execute(context.Background(), callDetails)
    if err != nil { t.Fatalf("Execute failed: %v", err) }
    if strings.TrimSpace(result) != "" { // MaxFiles=0 should return no files
        t.Errorf("Expected empty result for MaxFiles=0, got: %s", result)
    }
}

// TestSearchFilesTool_Pagination_NegativeOffset
func TestSearchFilesTool_Pagination_NegativeOffset(t *testing.T) {
    if !isRgInstalled() { t.Skip("rg not installed") }
    tempDir, _ := os.MkdirTemp("", "pagination_neg_offset")
    defer os.RemoveAll(tempDir)
    if err := os.WriteFile(filepath.Join(tempDir, "fileA.txt"), []byte("keyword"), 0644); err != nil { t.Fatal(err) }
    if err := os.WriteFile(filepath.Join(tempDir, "fileB.txt"), []byte("keyword"), 0644); err != nil { t.Fatal(err) }


    tool := &SearchFilesTool{}
    offset := -5 // Should be treated as 0
    args := SearchFilesArgs{Path: tempDir, Regex: "keyword", FileOffset: &offset}
    argsJSON, _ := json.Marshal(args)
    callDetails := FunctionCall{Content: string(argsJSON)}

    result, err := tool.Execute(context.Background(), callDetails)
    if err != nil { t.Fatalf("Execute failed: %v", err) }

    numResultFiles := countUniqueFilesFromRgJSON(t, result)
    if numResultFiles != 2 { // Expect all 2 files as offset becomes 0
        t.Errorf("Expected 2 files for negative offset (treated as 0), got %d. Output: %s", numResultFiles, result)
    }
}

// TestSearchFilesTool_Pagination_NegativeMaxFiles
// The behavior of negative MaxFiles is not explicitly defined in the implementation,
// but current logic (limit = *args.MaxFiles) would make it try to take a negative slice if not careful.
// The slice `paginatedFilePaths := uniqueFilePathsOrdered[offset:end]` where end = offset + limit
// If limit is negative, this could panic. Let's assume MaxFiles should be non-negative.
// The prompt implies "limit max amount", so negative doesn't make sense.
// For now, we'll assume callers provide non-negative MaxFiles.
// If MaxFiles is not provided, limit defaults to len(uniqueFilePathsOrdered).
// If MaxFiles is provided, it's used. The code doesn't explicitly check for negative MaxFiles.
// This could be an improvement: treat negative MaxFiles as "no limit" or error.
// For now, this test is omitted as it depends on desired behavior for invalid input.

// TestSearchFilesTool_Pagination_CorrectFileOrder
func TestSearchFilesTool_Pagination_CorrectFileOrder(t *testing.T) {
    if !isRgInstalled() { t.Skip("rg not installed") }
    tempDir, _ := os.MkdirTemp("", "pagination_order")
    defer os.RemoveAll(tempDir)

    // Create files out of alphabetical order to test sorting
    if err := os.WriteFile(filepath.Join(tempDir, "c_file.txt"), []byte("findme"), 0644); err != nil { t.Fatal(err) }
    if err := os.WriteFile(filepath.Join(tempDir, "a_file.txt"), []byte("findme"), 0644); err != nil { t.Fatal(err) }
    if err := os.WriteFile(filepath.Join(tempDir, "b_file.txt"), []byte("findme"), 0644); err != nil { t.Fatal(err) }

    tool := &SearchFilesTool{}
    maxFiles := 1
    offset1 := 0
    offset2 := 1
    offset3 := 2

    // Page 1
    args1 := SearchFilesArgs{Path: tempDir, Regex: "findme", MaxFiles: &maxFiles, FileOffset: &offset1}
    argsJSON1, _ := json.Marshal(args1)
    result1, err1 := tool.Execute(context.Background(), FunctionCall{Content: string(argsJSON1)})
    if err1 != nil { t.Fatalf("Execute page 1 failed: %v", err1) }
    paths1 := getFilePathsFromRgJSON(t, result1)
    if len(paths1) != 1 || !strings.HasSuffix(paths1[0], "a_file.txt") {
        t.Errorf("Page 1: Expected a_file.txt, got %v. Output: %s", paths1, result1)
    }

    // Page 2
    args2 := SearchFilesArgs{Path: tempDir, Regex: "findme", MaxFiles: &maxFiles, FileOffset: &offset2}
    argsJSON2, _ := json.Marshal(args2)
    result2, err2 := tool.Execute(context.Background(), FunctionCall{Content: string(argsJSON2)})
    if err2 != nil { t.Fatalf("Execute page 2 failed: %v", err2) }
    paths2 := getFilePathsFromRgJSON(t, result2)
    if len(paths2) != 1 || !strings.HasSuffix(paths2[0], "b_file.txt") {
        t.Errorf("Page 2: Expected b_file.txt, got %v. Output: %s", paths2, result2)
    }

    // Page 3
    args3 := SearchFilesArgs{Path: tempDir, Regex: "findme", MaxFiles: &maxFiles, FileOffset: &offset3}
    argsJSON3, _ := json.Marshal(args3)
    result3, err3 := tool.Execute(context.Background(), FunctionCall{Content: string(argsJSON3)})
    if err3 != nil { t.Fatalf("Execute page 3 failed: %v", err3) }
    paths3 := getFilePathsFromRgJSON(t, result3)
    if len(paths3) != 1 || !strings.HasSuffix(paths3[0], "c_file.txt") {
        t.Errorf("Page 3: Expected c_file.txt, got %v. Output: %s", paths3, result3)
    }
}
