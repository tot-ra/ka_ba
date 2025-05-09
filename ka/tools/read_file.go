package tools

import (
	"context"
	"encoding/json" // Added for parsing JSON from Content
	"fmt"
	"os"
	// "ka/a2a" // No longer needed for FunctionCall
)

// ReadFileTool implements the Tool interface for reading files.
type ReadFileTool struct{}

func (t *ReadFileTool) GetName() string {
	return "read_file"
}

func (t *ReadFileTool) GetDescription() string {
	return "Reads the contents of a file at the specified path."
}

func (t *ReadFileTool) GetXMLDefinition() string {
	return `<tool id="read_file">{"path": "path/to/file"}</tool>`
}

func (t *ReadFileTool) Execute(ctx context.Context, callDetails FunctionCall) (string, error) {
	var argsMap map[string]interface{}
	if err := json.Unmarshal([]byte(callDetails.Content), &argsMap); err != nil {
		return "", fmt.Errorf("failed to parse arguments JSON from Content for read_file: %w. Content: %s", err, callDetails.Content)
	}

	path, ok := argsMap["path"].(string)
	if !ok || path == "" {
		return "", fmt.Errorf("missing or invalid 'path' argument in JSON for read_file. Parsed args: %v", argsMap)
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("failed to read file %q: %w", path, err)
	}

	return string(content), nil
}
