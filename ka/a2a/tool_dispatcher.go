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

	// Parse arguments JSON string
	var argsMap map[string]json.RawMessage
	if err := json.Unmarshal([]byte(toolCall.Function.Arguments), &argsMap); err != nil {
		toolErr = fmt.Errorf("failed to parse tool arguments JSON: %w", err)
		log.Printf("[Task %s] Error parsing tool arguments for %s: %v", taskID, toolCall.Function.Name, toolErr)
		// Fall through to error handling below
	} else {
		// Dispatch based on tool name
		switch toolCall.Function.Name {
		case "list_files":
			var path string
			var recursive bool = false // Default to non-recursive

			// Extract 'path' argument
			if rawPath, ok := argsMap["path"]; ok {
				if err := json.Unmarshal(rawPath, &path); err != nil {
					toolErr = fmt.Errorf("failed to unmarshal 'path' argument: %w", err)
				}
			} else {
				toolErr = fmt.Errorf("missing required argument 'path' for list_files")
			}

			// Extract 'recursive' argument if present
			if rawRecursive, ok := argsMap["recursive"]; ok && toolErr == nil {
				if err := json.Unmarshal(rawRecursive, &recursive); err != nil {
					toolErr = fmt.Errorf("failed to unmarshal 'recursive' argument: %w", err)
				}
			}

			if toolErr == nil {
				// Execute the list_files tool
				files, err := tools.ListFiles(path, recursive)
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
