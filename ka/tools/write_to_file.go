package tools

import (
	"context"
	"fmt"
	"os"
	// "ka/a2a" // No longer needed for FunctionCall
)

// WriteToFileTool implements the Tool interface for writing content to a file.
type WriteToFileTool struct{}

// GetName returns the unique name of the tool.
func (t *WriteToFileTool) GetName() string {
	return "write_to_file"
}

// GetDescription returns a brief description of the tool's purpose.
func (t *WriteToFileTool) GetDescription() string {
	return "Writes the given content to a file at the specified path. Overwrites the file if it exists, or creates it if it does not."
}

// GetXMLDefinition returns the XML snippet describing how the LLM should call this tool.
func (t *WriteToFileTool) GetXMLDefinition() string {
	return `<tool id="write_to_file" path="path/to/your/file.txt">The content to write into the file goes here.</tool>`
}

// Execute performs the tool's action: writing content to a file.
// It expects the 'path' to be provided as an attribute in the tool call,
// and the content to be written as the inner data of the tool tag.
func (t *WriteToFileTool) Execute(ctx context.Context, callDetails FunctionCall) (string, error) {
	filePath, pathOk := callDetails.Attributes["path"]
	if !pathOk || filePath == "" {
		return "", fmt.Errorf("missing or empty 'path' attribute for write_to_file tool")
	}

	content := callDetails.Content // Content is the inner data of the XML tag

	// Write the content to the file. os.WriteFile creates the file if it doesn't exist,
	// and truncates it if it does. 0644 are standard file permissions.
	err := os.WriteFile(filePath, []byte(content), 0644)
	if err != nil {
		return "", fmt.Errorf("failed to write to file %q: %w", filePath, err)
	}

	return fmt.Sprintf("Successfully wrote content to %s", filePath), nil
}
