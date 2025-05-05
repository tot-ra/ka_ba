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
	taskStore      TaskStore
	availableTools map[string]tools.Tool // Map of available tools
}

// NewToolDispatcher creates a new ToolDispatcher.
// It now accepts the map of available tools.
func NewToolDispatcher(store TaskStore, availableTools map[string]tools.Tool) *ToolDispatcher {
	return &ToolDispatcher{
		taskStore:      store,
		availableTools: availableTools,
	}
}

// DispatchToolCall takes a ToolCall and executes the corresponding tool function.
// It returns a Message with RoleTool containing the result, or an error.
func (td *ToolDispatcher) DispatchToolCall(ctx context.Context, taskID string, toolCall ToolCall) (Message, error) {
	log.Printf("[Task %s] Dispatching tool call: %s", taskID, toolCall.Function.Name)

	// Find the tool implementation by name
	tool, ok := td.availableTools[toolCall.Function.Name]
	if !ok {
		toolErr := fmt.Errorf("unknown tool: %s", toolCall.Function.Name)
		log.Printf("[Task %s] %v", taskID, toolErr)
		// Construct an error message for the LLM
		toolMessage := Message{
			Role:       RoleTool,
			ToolCallID: toolCall.ID,
			Parts: []Part{TextPart{
				Type: "text",
				Text: fmt.Sprintf("Error: Tool '%s' not found.", toolCall.Function.Name),
			}},
		}
		return toolMessage, toolErr // Return the message and the error
	}

	// Arguments are expected as a string within the FunctionCall struct
	argsString := toolCall.Function.Arguments
	var argsMap map[string]interface{}

	// Attempt to unmarshal the arguments string into a map
	if err := json.Unmarshal([]byte(argsString), &argsMap); err != nil {
		toolErr := fmt.Errorf("failed to parse arguments JSON for tool %s: %w", toolCall.Function.Name, err)
		log.Printf("[Task %s] Error parsing arguments for tool %s: %v. Raw args: %s", taskID, toolCall.Function.Name, toolErr, argsString)
		// Construct an error message for the LLM
		toolMessage := Message{
			Role:       RoleTool,
			ToolCallID: toolCall.ID,
			Parts: []Part{TextPart{
				Type: "text",
				Text: fmt.Sprintf("Error parsing arguments for tool '%s': Invalid JSON format. Expected a JSON object.", toolCall.Function.Name),
			}},
		}
		return toolMessage, toolErr // Return the message and the error
	}

	// Execute the tool's Execute method
	toolResultString, toolErr := tool.Execute(ctx, argsMap)

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
		// If tool execution was successful, add the result as a text part
		toolMessage.Parts = append(toolMessage.Parts, TextPart{
			Type: "text",
			Text: toolResultString, // Use the string result directly
		})
		log.Printf("[Task %s] Tool %s executed successfully. Result: %s", taskID, toolCall.Function.Name, toolResultString)
	}

	// Return the constructed tool message and the original tool error (if any)
	return toolMessage, toolErr
}
