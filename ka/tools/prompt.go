package tools

import (
	"fmt"
	"log"
	"os"
	"os/user"
	"runtime"
	"strings"
	"time"
)

// SystemContext holds information about the current system environment.
type SystemContext struct {
	OS      string
	Shell   string
	User    string
	Time    string
	WorkDir string
}

// getSystemContext fetches current system information.
func getSystemContext() SystemContext {
	currentOS := runtime.GOOS
	currentShell := os.Getenv("SHELL")
	if currentShell == "" {
		currentShell = "unknown" // Fallback
	}
	currentTime := time.Now().Format(time.RFC1123)

	currentUser := "unknown"
	usr, err := user.Current()
	if err == nil {
		currentUser = usr.Username
	} else {
		// Log the error but continue with a default value
		log.Printf("[getSystemContext] Error getting current user: %v", err)
	}

	currentDir, err := os.Getwd()
	if err != nil {
		// Log the error but continue with a default value
		log.Printf("[getSystemContext] Error getting current working directory: %v", err)
		currentDir = "unknown" // Fallback
	}

	return SystemContext{
		OS:      currentOS,
		Shell:   currentShell,
		User:    currentUser,
		Time:    currentTime,
		WorkDir: currentDir,
	}
}

// ComposeSystemPrompt constructs the full XML system prompt based on selected tools and MCP servers.
// Updated to accept McpServerConfig objects instead of just names.
func ComposeSystemPrompt(selectedToolNames []string, selectedMcpServers []McpServerConfig, availableTools map[string]Tool) string {
	context := getSystemContext()
	var promptBuilder strings.Builder // Use a builder for efficiency

	// Base system prompt
	basePrompt := `You are an expert software engineer.

OBJECTIVE
====
You accomplish a given task iteratively, breaking it down into clear steps and working through them methodically.
- Analyze the user's task and set clear, achievable goals to accomplish it. Prioritize these goals in a logical order.
- Work through these goals sequentially, utilizing available tools one at a time as necessary. Each goal should correspond to a distinct step in your problem-solving process.
- Remember, you have extensive capabilities with access to a wide range of tools that can be used in powerful and clever ways as necessary to accomplish each goal.
- DO NOT ask for more information on optional parameters if it is not provided.
- You may also provide a CLI command to showcase the result of your task; this can be particularly useful for web development tasks, where you can run e.g. open index.html to show the website you've built.
- The user may provide feedback, which you can use to make improvements and try again.


COMMUNICATION STYLE
====
- But DO NOT continue in pointless back and forth conversations, i.e. don't end your responses with questions or offers for further assistance.
- You are STRICTLY FORBIDDEN from starting your messages with "Great", "Certainly", "Okay", "Sure". You should NOT be conversational in your responses, but rather direct and to the point.

TOOLS
====
- Choose the most appropriate tool based on the task and the tool descriptions provided
- If multiple actions are needed, use one tool at a time per message to accomplish the task iteratively, with each tool use being informed by the result of the previous tool use. Do not assume the outcome of any tool use. Each step must be informed by the previous step's result.
- Do not use the ~ character or $HOME to refer to the home directory.



You have access to the following tools:
`
	promptBuilder.WriteString(basePrompt)

	// Add tool call instruction block with specific formats for each tool and MCP server
	promptBuilder.WriteString(`
Tool Invocation Formats:
You can invoke tools using the following XML formats. Use the specific format for each tool:
`)
	for _, toolName := range selectedToolNames {
		if tool, ok := availableTools[toolName]; ok {

			if tool.GetName() == "mcp"  && len(selectedMcpServers) > 0 {
				fmt.Fprintf(&promptBuilder, "\n\n## Tool \"%s\"\n%s\n%s", tool.GetName(), tool.GetDescription(), tool.GetXMLDefinition())
				promptBuilder.WriteString("\nConnected MCP Servers:\n")
				for _, server := range selectedMcpServers {
					fmt.Fprintf(&promptBuilder, "\n### %s (`%s`)\n", server.Name, server.Command) // Include command for context

					if len(server.Tools) > 0 {
						promptBuilder.WriteString("\n#### Available Tools\n")
						for _, tool := range server.Tools {
							fmt.Fprintf(&promptBuilder, "- %s: %s\n", tool.Name, tool.Description)
							// TODO: Include input schema here if available in ToolDefinition
						}
					}

					if len(server.Resources) > 0 {
						promptBuilder.WriteString("\n#### Available Resources\n")
						for _, resource := range server.Resources {
							fmt.Fprintf(&promptBuilder, "- %s\n", resource)
						}
					}
					promptBuilder.WriteString("\n") // Add a newline after each server
				}
			
			} else {
				// It's good practice to ensure GetXMLDefinition() doesn't return empty or excessively long strings.
				// For now, we assume it's well-behaved.
				fmt.Fprintf(&promptBuilder, "\n\n## Tool \"%s\"\n%s\n%s", tool.GetName(), tool.GetDescription(), tool.GetXMLDefinition())
			}
		}
	}




fmt.Fprintf(&promptBuilder, `
SYSTEM INFORMATION
====
Operating System: %s
Shell: %s
Agent start time: %s
Current User: %s
Current Working Directory: %s`, context.OS, context.Shell, context.User, context.Time, context.WorkDir)

	return promptBuilder.String()
}
