package tools

// GetAllTools returns a slice containing instances of all available tools.
func GetAllTools() []Tool {
	return []Tool{
		&ListFilesTool{},
		&GetTimeTool{},
		&ReadFileTool{},
		// Add instances of other tool implementations here as they are created.
		// Example: &WriteFileTool{}, etc.
	}
}
