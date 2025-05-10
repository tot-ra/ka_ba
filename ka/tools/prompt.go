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

// ComposeSystemPrompt constructs the full XML system prompt based on selected tools.
func ComposeSystemPrompt(selectedToolNames []string, availableTools map[string]Tool) string {
	context := getSystemContext()
	var toolDefinitionsXML strings.Builder

	// Base system prompt
	basePrompt := `You are an expert software engineer.

OBJECTIVE
====
You accomplish a given task iteratively, breaking it down into clear steps and working through them methodically.
- Analyze the user's task and set clear, achievable goals to accomplish it. Prioritize these goals in a logical order.
- Work through these goals sequentially, utilizing available tools one at a time as necessary. Each goal should correspond to a distinct step in your problem-solving process. 
- Remember, you have extensive capabilities with access to a wide range of tools that can be used in powerful and clever ways as necessary to accomplish each goal. 
- DO NOT ask for more information on optional parameters if it is not provided.
- Once you've completed the user's task, you must use the attempt_completion tool to present the result of the task to the user. 
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
- Before calling a tool, do some analysis within <thinking></thinking> tags. First, analyze the file structure provided in environment_details to gain context and insights for proceeding effectively. 
Then, think about which of the provided tools is the most relevant tool to accomplish the user's task. 
Next, go through each of the required parameters of the relevant tool and determine if the user has directly provided or given enough information to infer a value. 
When deciding if the parameter can be inferred, carefully consider all the context to see if it supports a specific value. 
If all of the required parameters are present or can be reasonably inferred, close the thinking tag and proceed with the tool use. 
BUT, if one of the values for a required parameter is missing, DO NOT invoke the tool (not even with fillers for the missing params) and instead, 
ask the user to provide the missing parameters using the ask_followup_question tool. 



You have access to the following tools:
`
	fmt.Fprintf(&toolDefinitionsXML, basePrompt)

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

fmt.Fprintf(&toolDefinitionsXML, `
SYSTEM INFORMATION
====
Operating System: %s
Shell: %s
Current User: %s
Current Time: %s
Current Working Directory: %s`, context.OS, context.Shell, context.User, context.Time, context.WorkDir)

	return toolDefinitionsXML.String()
}
