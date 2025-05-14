package tools

// GetAllTools returns a slice containing instances of all available tools.
func GetAllTools() []Tool {
	return []Tool{
		&ListFilesTool{},
		&GetTimeTool{},
		&ReadFileTool{},
		&WriteToFileTool{},
		&SearchFilesTool{},
		&AskFollowupQuestionTool{},
		&AddTaskTool{},
		&McpTool{}, // Added the new McpTool
		&ExecuteCommandTool{}, // Added the new ExecuteCommandTool
		// Add instances of other tool implementations here as they are created.
		// Example: &WriteFileTool{}, etc.
	}
}
