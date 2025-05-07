package tools

// GetAllTools returns a slice containing instances of all available tools.
func GetAllTools() []Tool {
	return []Tool{
		&ListFilesTool{},
		&GetTimeTool{},
		// Add instances of other tool implementations here as they are created.
		// Example: &ReadFileTool{}, &WriteFileTool{}, etc.
	}
}
