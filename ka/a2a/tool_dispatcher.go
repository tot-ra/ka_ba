package a2a

import (
	"context"
	// "encoding/json" // No longer needed as JSON parsing is done by individual tools
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
	log.Printf("[Task %s] Dispatching tool call: %s (ID: %s)", taskID, toolCall.Function.Name, toolCall.ID)

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

	// The toolCall.Function (which is an a2a.FunctionCall struct) now contains
	// Name, Attributes, and Content.
	// Each tool's Execute method is responsible for interpreting these as needed.
	// For tools expecting JSON arguments, they will parse toolCall.Function.Content.
	log.Printf("[Task %s] Executing tool %s with Attributes: %v, ContentLength: %d", taskID, toolCall.Function.Name, toolCall.Function.Attributes, len(toolCall.Function.Content))

	// Execute the tool's Execute method, passing the entire FunctionCall detail
	toolResultString, toolErr := tool.Execute(ctx, toolCall.Function)

	// Construct the tool message response
	toolMessage := Message{
		Role:       RoleTool,
		ToolCallID: toolCall.ID,
		Parts:      []Part{}, // Initialize parts slice
	}

	if toolErr != nil {
		// If there was an error executing the tool, return an error message
		log.Printf("[Task %s] Tool execution failed for %s (ID: %s): %v", taskID, toolCall.Function.Name, toolCall.ID, toolErr)
		toolMessage.Parts = append(toolMessage.Parts, TextPart{
			Type: "text",
			Text: fmt.Sprintf("Error executing tool %s (ID: %s): %v", toolCall.Function.Name, toolCall.ID, toolErr),
		})
	} else {
		// If tool execution was successful, add the result as a text part
		toolMessage.Parts = append(toolMessage.Parts, TextPart{
			Type: "text",
			Text: toolResultString, // Use the string result directly
		})
		log.Printf("[Task %s] Tool %s (ID: %s) executed successfully. Result: %s", taskID, toolCall.Function.Name, toolCall.ID, toolResultString)
	}

	// Return the constructed tool message and the original tool error (if any)
	return toolMessage, toolErr
}
