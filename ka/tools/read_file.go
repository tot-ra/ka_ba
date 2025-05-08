package tools

import (
	"context"
	"fmt"
	"os"
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

func (t *ReadFileTool) Execute(ctx context.Context, args map[string]interface{}) (string, error) {
	path, ok := args["path"].(string)
	if !ok || path == "" {
		return "", fmt.Errorf("missing or invalid 'path' argument")
	}

	content, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("failed to read file %q: %w", path, err)
	}

	return string(content), nil
}
