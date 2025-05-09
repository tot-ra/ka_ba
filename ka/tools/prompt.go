package tools

import (
	"fmt"
	"strings"
)

// ComposeSystemPrompt constructs the full XML system prompt based on selected tools.
func ComposeSystemPrompt(selectedToolNames []string, availableTools map[string]Tool, currentDir string) string {
	var toolDefinitionsXML strings.Builder

	// Base system prompt
	// Updated to start with "You are an expert software engineer" as requested
	basePrompt := `You are an expert software engineer.
Your current working directory is: %s

You have access to the following tools:
`
	fmt.Fprintf(&toolDefinitionsXML, basePrompt, currentDir)

	// Add definitions for selected tools
	for _, toolName := range selectedToolNames {
		if tool, ok := availableTools[toolName]; ok {
			fmt.Fprintf(&toolDefinitionsXML, "- %s: %s\n", tool.GetName(), tool.GetDescription())
		}
	}

	// Add tool call instruction block with specific formats for each tool
	toolDefinitionsXML.WriteString(`
Tool Invocation Formats:
You can invoke tools using the following XML formats. Use the specific format for each tool:
`)
	for _, toolName := range selectedToolNames {
		if tool, ok := availableTools[toolName]; ok {
			// It's good practice to ensure GetXMLDefinition() doesn't return empty or excessively long strings.
			// For now, we assume it's well-behaved.
			fmt.Fprintf(&toolDefinitionsXML, "\nFor tool '%s':\n%s\n", tool.GetName(), tool.GetXMLDefinition())
		}
	}

	toolDefinitionsXML.WriteString(`
Think step by step and provide clear instructions to the user or use tools when necessary.
`)

	return toolDefinitionsXML.String()
}
