package tools

import (
	"context"
	"encoding/json" // Added for parsing JSON from Content
	"fmt"
	"os"
	"path/filepath"
	"strings"
	// "ka/a2a" // No longer needed for FunctionCall
)

// ListFiles lists files and directories in the given path.
// If recursive is true, it lists contents recursively.
func ListFiles(path string, recursive bool) ([]string, error) {
	var fileList []string
	err := filepath.Walk(path, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			// Log the error but continue walking
			fmt.Printf("Error accessing path %q: %v\n", path, err)
			return nil // Don't stop the walk on errors
		}
		// Add the path to the list
		fileList = append(fileList, path)

		if !recursive && info.IsDir() && path != "." && path != "/" {
			// If not recursive and it's a directory (and not the starting path), skip its contents
			return filepath.SkipDir
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("error walking the path %q: %v", path, err)
	}

	return fileList, nil
}

// ListFilesTool implements the Tool interface for listing files.
type ListFilesTool struct{}

func (t *ListFilesTool) GetName() string {
	return "list_files"
}

func (t *ListFilesTool) GetDescription() string {
	return "Lists files and directories in a specified path."
}

func (t *ListFilesTool) GetXMLDefinition() string {
	return `<tool id="list_files">{"path": ".", "recursive": false}</tool>`
}

func (t *ListFilesTool) Execute(ctx context.Context, callDetails FunctionCall) (string, error) {
	var argsMap map[string]interface{}
	if err := json.Unmarshal([]byte(callDetails.Content), &argsMap); err != nil {
		return "", fmt.Errorf("failed to parse arguments JSON from Content for list_files: %w. Content: %s", err, callDetails.Content)
	}

	path, ok := argsMap["path"].(string)
	if !ok || path == "" {
		path = "." // Default to current directory if path is missing or empty
	}

	recursive, recursiveOk := argsMap["recursive"].(bool)
	if !recursiveOk {
		recursive = false // Default to non-recursive
	}

	var files []string
	if recursive {
		err := filepath.Walk(path, func(p string, info os.FileInfo, err error) error {
			if err != nil {
				// Log the error but continue walking
				fmt.Fprintf(os.Stderr, "Error accessing path %q: %v\n", p, err)
				return nil // Don't stop the walk on individual errors
			}
			// Add path relative to the requested path
			relPath, err := filepath.Rel(path, p)
			if err != nil {
				fmt.Fprintf(os.Stderr, "Error getting relative path for %q: %v\n", p, err)
				files = append(files, p) // Add full path if relative fails
			} else {
				files = append(files, relPath)
			}
			return nil
		})
		if err != nil {
			return "", fmt.Errorf("failed to walk directory %q: %w", path, err)
		}
	} else {
		entries, err := os.ReadDir(path)
		if err != nil {
			return "", fmt.Errorf("failed to read directory %q: %w", path, err)
		}
		for _, entry := range entries {
			files = append(files, entry.Name())
		}
	}

	// Format the output for the LLM
	if len(files) == 0 {
		return fmt.Sprintf("No files found in %q.", path), nil
	}

	// Simple list format for now
	return "Files:\n" + strings.Join(files, "\n"), nil
}
