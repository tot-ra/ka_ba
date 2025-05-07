package tools

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Tool is an interface that represents a tool available to the AI agent.
type Tool interface {
	// GetName returns the unique name of the tool.
	GetName() string
	// GetDescription returns a brief description of the tool's purpose.
	GetDescription() string
	// GetXMLDefinition returns the XML snippet describing how the LLM should call this tool.
	GetXMLDefinition() string
	// Execute performs the tool's action with the given arguments.
	Execute(ctx context.Context, args map[string]interface{}) (string, error)
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

func (t *ListFilesTool) Execute(ctx context.Context, args map[string]interface{}) (string, error) {
	path, ok := args["path"].(string)
	if !ok || path == "" {
		path = "." // Default to current directory if path is missing or empty
	}

	recursive, recursiveOk := args["recursive"].(bool)
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

// Add other tool implementations here following the same pattern.
// Example: ReadFileTool, WriteFileTool, ExecuteCommandTool, etc.
