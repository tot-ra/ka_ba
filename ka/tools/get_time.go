package tools

import (
	"context"
	"time"
)

// GetTimeTool implements the Tool interface for getting the current time.
type GetTimeTool struct{}

func (t *GetTimeTool) GetName() string {
	return "get_current_time"
}

func (t *GetTimeTool) GetDescription() string {
	return "Gets the current date and time."
}

func (t *GetTimeTool) GetXMLDefinition() string {
	return `<tool id="get_current_time">{}</tool>`
}

func (t *GetTimeTool) Execute(ctx context.Context, args map[string]interface{}) (string, error) {
	currentTime := time.Now().Format(time.RFC1123Z) // Format the time for readability
	return currentTime, nil
}
