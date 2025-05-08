package tools

import "context"

// Tool is an interface that represents a tool available to the AI agent.
type Tool interface {
	// GetName returns the unique name of the tool.
	GetName() string
	// GetDescription returns a brief description of the tool's purpose.
	GetDescription() string
	// GetXMLDefinition returns the XML snippet describing how the LLM should call this tool.
	GetXMLDefinition() string
	// Execute performs the tool's action with the given arguments.
	Execute(ctx context.Context, args map[string]interface{}) (string, error)
}