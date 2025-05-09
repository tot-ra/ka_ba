package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"sort"
	"strings"
)

// SearchFilesArgs defines the arguments for the search_files tool.
type SearchFilesArgs struct {
	Path        string  `json:"path"`
	Regex       string  `json:"regex"`
	FilePattern *string `json:"file_pattern,omitempty"`
	MaxFiles    *int    `json:"max_files,omitempty"`
	FileOffset  *int    `json:"file_offset,omitempty"`
}

// SearchFilesTool implements the Tool interface for searching files using ripgrep.
type SearchFilesTool struct{}

func (t *SearchFilesTool) GetName() string {
	return "search_files"
}

func (t *SearchFilesTool) GetDescription() string {
	return "Request to perform a regex search across files in a specified directory, providing context-rich results. Uses Rust regex syntax."
}

func (t *SearchFilesTool) GetXMLDefinition() string {
	return `<tool id="search_files">{"path": "path/to/directory", "regex": "your_regex_pattern (e.g., \\\\.log$ to find .log files)", "file_pattern": "*.go" (optional), "max_files": 100 (optional), "file_offset": 0 (optional)}</tool>`
}

func (t *SearchFilesTool) Execute(ctx context.Context, callDetails FunctionCall) (string, error) {
	var args SearchFilesArgs
	if err := json.Unmarshal([]byte(callDetails.Content), &args); err != nil {
		return "", fmt.Errorf("failed to parse arguments JSON from Content for search_files: %w. Content: %s", err, callDetails.Content)
	}

	if args.Path == "" {
		return "", fmt.Errorf("missing required 'path' argument for search_files")
	}
	if args.Regex == "" {
		return "", fmt.Errorf("missing required 'regex' argument for search_files")
	}

	cmdArgs := []string{"--json", "-e", args.Regex}

	if args.FilePattern != nil && *args.FilePattern != "" {
		cmdArgs = append(cmdArgs, "-g", *args.FilePattern)
	}
	cmdArgs = append(cmdArgs, args.Path)

	cmd := exec.CommandContext(ctx, "rg", cmdArgs...)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		if stderr.Len() > 0 {
			return "", fmt.Errorf("ripgrep execution failed for search_files: %s. Stderr: %s", err, stderr.String())
		}
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() > 1 {
			return "", fmt.Errorf("ripgrep execution error for search_files (exit code %d): %s. Stderr: %s", exitErr.ExitCode(), err, stderr.String())
		}
	}

	// If no pagination, return the full output
	if args.MaxFiles == nil && args.FileOffset == nil {
		return stdout.String(), nil
	}

	// Process output for pagination
	var allEntries []map[string]interface{}
	var uniqueFilePathsOrdered []string // To maintain order of first appearance
	filePathSet := make(map[string]bool)
	
	decoder := json.NewDecoder(&stdout) // Use the original stdout buffer
	for decoder.More() {
		var entry map[string]interface{}
		if err := decoder.Decode(&entry); err != nil {
			// This might happen if rg output is not a continuous stream of JSON objects,
			// or if there's an actual error in the JSON.
			// If stdout was empty or only whitespace, this loop might not even run or err.
			if stdout.String() != "" && strings.TrimSpace(stdout.String()) != "" { // only error if there was content
				return "", fmt.Errorf("failed to decode rg JSON output entry for pagination: %w. Partial output: %s", err, stdout.String())
			}
			break // Stop if no more decodable JSON
		}
		allEntries = append(allEntries, entry)

		entryType, _ := entry["type"].(string)
		var currentFilePath string
		if data, ok := entry["data"].(map[string]interface{}); ok {
			if pathData, ok := data["path"].(map[string]interface{}); ok {
				if pathText, ok := pathData["text"].(string); ok {
					currentFilePath = pathText
				}
			}
		}

		if currentFilePath != "" && (entryType == "begin" || entryType == "match") {
			if _, exists := filePathSet[currentFilePath]; !exists {
				filePathSet[currentFilePath] = true
				uniqueFilePathsOrdered = append(uniqueFilePathsOrdered, currentFilePath)
			}
		}
	}
	
	// Sort unique file paths for stable pagination
	sort.Strings(uniqueFilePathsOrdered)

	// Apply pagination
	offset := 0
	if args.FileOffset != nil {
		offset = *args.FileOffset
	}
	limit := len(uniqueFilePathsOrdered) // Default to all if MaxFiles not set or too large
	if args.MaxFiles != nil {
		limit = *args.MaxFiles
	}

	if offset < 0 {
		offset = 0
	}
	if offset >= len(uniqueFilePathsOrdered) { // Offset is beyond the number of files
		return "", nil // Return empty string (or perhaps an empty JSON array "[]")
	}

	end := offset + limit
	if end > len(uniqueFilePathsOrdered) {
		end = len(uniqueFilePathsOrdered)
	}

	paginatedFilePaths := uniqueFilePathsOrdered[offset:end]
	paginatedFileSet := make(map[string]bool)
	for _, p := range paginatedFilePaths {
		paginatedFileSet[p] = true
	}

	var resultEntries []string
	for _, entry := range allEntries {
		entryType, _ := entry["type"].(string)
		includeEntry := false

		if entryType == "summary" { // Exclude original summary for paginated results for now
			continue
		}

		var entryFilePath string
		if data, ok := entry["data"].(map[string]interface{}); ok {
			if pathData, ok := data["path"].(map[string]interface{}); ok {
				if pathText, ok := pathData["text"].(string); ok {
					entryFilePath = pathText
				}
			}
		}

		if entryFilePath != "" && (entryType == "begin" || entryType == "match" || entryType == "end") {
			if _, exists := paginatedFileSet[entryFilePath]; exists {
				includeEntry = true
			}
		} else if entryType != "begin" && entryType != "match" && entryType != "end" && entryType != "summary" {
			// Include other types of entries if any (though rg --json usually sticks to these)
			// This case might not be strictly necessary for rg's typical output.
		}


		if includeEntry {
			jsonBytes, err := json.Marshal(entry)
			if err != nil {
				return "", fmt.Errorf("failed to re-marshal JSON entry for pagination: %w", err)
			}
			resultEntries = append(resultEntries, string(jsonBytes))
		}
	}
	return strings.Join(resultEntries, "\n"), nil
}
