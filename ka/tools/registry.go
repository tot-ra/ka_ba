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
		&McpTool{},
		&ExecuteCommandTool{},
	}
}
