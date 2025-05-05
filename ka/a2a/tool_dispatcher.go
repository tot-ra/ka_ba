package a2a

import (
	"context"
	"encoding/json"
	"fmt"
	"log"

	"ka/tools" // Import the tools package
)

// ToolDispatcher handles routing tool calls to the appropriate tool implementations.
type ToolDispatcher struct {
	// Add any dependencies needed by tools here (e.g., TaskStore)
	taskStore TaskStore
}

// NewToolDispatcher creates a new ToolDispatcher.
func NewToolDispatcher(store TaskStore) *ToolDispatcher {
	return &ToolDispatcher{
		taskStore: store,
	}
}

// DispatchToolCall takes a ToolCall and executes the corresponding tool function.
// It returns a Message with RoleTool containing the result, or an error.
func (td *ToolDispatcher) DispatchToolCall(ctx context.Context, taskID string, toolCall ToolCall) (Message, error) {
	log.Printf("[Task %s] Dispatching tool call: %s", taskID, toolCall.Function.Name)

	var toolResult interface{}
	var toolErr error

	// Arguments are now expected as a string within the FunctionCall struct
	argsString := toolCall.Function.Arguments

	// Dispatch based on tool name
	switch toolCall.Function.Name {
	case "list_files":
		// For list_files, the arguments string is expected to be a JSON object
		var args struct {
			Path string `json:"path"`
			Recursive bool `json:"recursive,omitempty"` // Optional
		}

		if err := json.Unmarshal([]byte(argsString), &args); err != nil {
			toolErr = fmt.Errorf("failed to parse list_files arguments JSON: %w", err)
			log.Printf("[Task %s] Error parsing list_files arguments: %v. Raw args: %s", taskID, toolErr, argsString)
		} else {
			// Execute the list_files tool
			files, err := tools.ListFiles(args.Path, args.Recursive)
			if err != nil {
				toolErr = fmt.Errorf("list_files execution failed: %w", err)
			} else {
				toolResult = files // The result is the list of files
			}
		}

	// Add cases for other tools here
	// case "another_tool":
	// ...

	default:
		toolErr = fmt.Errorf("unknown tool: %s", toolCall.Function.Name)
	}


	// Construct the tool message response
	toolMessage := Message{
		Role:       RoleTool,
		ToolCallID: toolCall.ID,
		Parts:      []Part{}, // Initialize parts slice
	}

	if toolErr != nil {
		// If there was an error executing the tool, return an error message
		log.Printf("[Task %s] Tool execution failed for %s: %v", taskID, toolCall.Function.Name, toolErr)
		toolMessage.Parts = append(toolMessage.Parts, TextPart{
			Type: "text",
			Text: fmt.Sprintf("Error executing tool %s: %v", toolCall.Function.Name, toolErr),
		})
	} else {
		// If tool execution was successful, format the result
		resultBytes, marshalErr := json.Marshal(toolResult)
		if marshalErr != nil {
			log.Printf("[Task %s] Error marshalling tool result for %s: %v", taskID, toolCall.Function.Name, marshalErr)
			toolMessage.Parts = append(toolMessage.Parts, TextPart{
				Type: "text",
				Text: fmt.Sprintf("Error formatting tool result for %s: %v", toolCall.Function.Name, marshalErr),
			})
			// Also return the marshalling error
			return toolMessage, fmt.Errorf("failed to marshal tool result: %w", marshalErr)
		}

		// Add the JSON result as a text part
		toolMessage.Parts = append(toolMessage.Parts, TextPart{
			Type: "text",
			Text: string(resultBytes), // Send the JSON string result back
		})
		log.Printf("[Task %s] Tool %s executed successfully. Result: %s", taskID, toolCall.Function.Name, string(resultBytes))
	}

	// Return the constructed tool message and the original tool error (if any)
	return toolMessage, toolErr
}
