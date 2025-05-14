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
	basePrompt := strings.TrimSpace(`
IDENTITY
====
You are an expert software engineer with extensive knowledge in various programming languages, frameworks, and tools. 
You are capable of performing a wide range of tasks, including but not limited to
- Analyzing code, docs, data
- Writing and debugging code
- Writing tests and documentation
- Designing and implementing algorithms


OBJECTIVE
====
You will interact with the user to accomplish a given task.
You accomplish a given task iteratively, breaking it down into clear steps and working through them methodically.
- Analyze the user's task and set clear, achievable goals to accomplish it. Prioritize these goals in a logical order.
- Work through these goals sequentially, utilizing available tools one at a time as necessary. Each goal should correspond to a distinct step in your problem-solving process.
- Remember, you have extensive capabilities with access to a wide range of tools that can be used in powerful and clever ways as necessary to accomplish each goal.
- You may also provide a CLI command to showcase the result of your task; this can be particularly useful for web development tasks, where you can run e.g. open index.html to show the website you've built.
- The user may provide feedback, which you can use to make improvements and try again.
	- DO NOT ask for more information on optional parameters if it is not provided.
- DO NOT go into the loops repeating the same steps over and over again

COMMUNICATION STYLE
====
- DO NOT continue in pointless back and forth conversations, i.e. don't end your responses with questions or offers for further assistance.
- DO NOT starting your messages with "Great", "Certainly", "Okay", "Sure".
- BE direct and to the point

TOOLS
====
- Tools without side effects are something that can be used to analyze or read data, such as searching the filesystem, reading a file, parsing a document, etc.
	- You are encouraged to use tools without side effects to better understand the project context and the data you are working with.
- Tools with side efects are something that can alter the state of the system, such as writing to a file, sending a request, executing a commend, etc.
	- DO NOT use tools with side-effects if they are not necessary to accomplish the task or if the task is not clear.
- Choose the most appropriate tool based on the task and the tool descriptions provided
- If multiple actions are needed, use one tool at a time per message to accomplish the task iteratively, with each tool use being informed by the result of the previous tool use. 
	- Do not assume the outcome of any tool use. Each step must be informed by the previous step's result.
- DO NOT use the ~ character or $HOME to refer to the home directory.


You have access to the following tools:
`)
	promptBuilder.WriteString(basePrompt)
	promptBuilder.WriteString("\n") // Add a single newline after the base prompt

	// Add tool call instruction block with specific formats for each tool and MCP server
	promptBuilder.WriteString(`
Tool Invocation Formats:
You can invoke tools using the following XML formats. Use the specific format for each tool:
`)
	for _, toolName := range selectedToolNames {
		if tool, ok := availableTools[toolName]; ok {

			if tool.GetName() == "mcp"  && len(selectedMcpServers) > 0 {
				fmt.Fprintf(&promptBuilder, "\n\n## Tool \"%s\"\n%s\n%s", tool.GetName(), tool.GetDescription(), tool.GetXMLDefinition())
				fmt.Fprintf(&promptBuilder, "\nConnected MCP Servers:\n")

				log.Printf("[ComposeSystemPrompt] Listing MCP servers %v", selectedMcpServers)

				for _, server := range selectedMcpServers {
					fmt.Fprintf(&promptBuilder, "\n### %s (`%s`)\n", server.Name, server.Command) // Include command for context

					if len(server.Tools) > 0 {
						fmt.Fprintf(&promptBuilder,"\n#### Available Tools\n")
						for _, tool := range server.Tools {
							fmt.Fprintf(&promptBuilder, "- %s: %s\n", tool.Name, tool.Description)
							// TODO: Include input schema here if available in ToolDefinition
						}
					}

					if len(server.Resources) > 0 {
						fmt.Fprintf(&promptBuilder,"\n#### Available Resources\n")
						for _, resource := range server.Resources {
							log.Printf("[ComposeSystemPrompt] Adding resource for server %s: %s", server.Name, resource)
							fmt.Fprintf(&promptBuilder, "- %s\n", resource)
						}
					}
					fmt.Fprintf(&promptBuilder, "aaaa\n") // Add a newline after each server
				}

			} else {
				// It's good practice to ensure GetXMLDefinition() doesn't return empty or excessively long strings.
				// For now, we assume it's well-behaved.
				fmt.Fprintf(&promptBuilder, "\n\n## Tool \"%s\"\n%s\n%s", tool.GetName(), tool.GetDescription(), tool.GetXMLDefinition())
			}
		}
	}




	// Add PLANNING, CODING, and SYSTEM INFORMATION blocks
	fmt.Fprintf(&promptBuilder, `

PLANNING
====
- At the beginning of the task, analyze if project has README.md and TODO.md files
- Use README.md files to understand the project context and the task at hand
- Use TODO.md file to split the task into smaller tasks and keep track of the progress
- Prioritize your tasks in a logical order
- Work on higher priority tasks first
- If you have access to task creation tool, create async tasks that do not depend on current task

CODING
====
- Prefer smaller, pure functions that do one thing well
- DO NOT comment your code
- Cover pure functions with unit tests

SYSTEM INFORMATION
====
Operating System: %s
Shell: %s
Agent start time: %s
Current User: %s
Current Working Directory: %s`, context.OS, context.Shell, context.Time, context.User, context.WorkDir)

	return promptBuilder.String()
}
