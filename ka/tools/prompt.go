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

	// Add tool call instruction block
	toolDefinitionsXML.WriteString(`
When you need to use a tool, output an XML block like this:
<tool_code>
  <tool_call id="call_abc" type="function">
    <function>
      <name>tool_name</name>
      <arguments>
        {"param1": "value1", "param2": "value2"}
      </arguments>
    </function>
  </tool_call>
</tool_code>

Think step by step and provide clear instructions to the user or use tools when necessary.
`)

	return toolDefinitionsXML.String()
}
