package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const AddTaskSentinelPrefix = "[NEW_TASK_REQUEST]"

// AddTaskTool allows creating a new, independent task.
type AddTaskTool struct{}

// AddTaskArgs defines the structure for the JSON arguments.
type AddTaskArgs struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Context     string `json:"context"`
}

// NewTaskRequestData is the data structure for the sentinel string.
type NewTaskRequestData struct {
	ParentTaskID string `json:"parent_task_id"`
	Name         string `json:"name"`
	Description  string `json:"description"` // This will be the initial user message for the new task
	SystemPrompt string `json:"system_prompt"` // This will be the system prompt for the new task
}

// GetName returns the name of the tool.
func (t *AddTaskTool) GetName() string {
	return "add_task"
}

// GetDescription returns a description of the tool.
func (t *AddTaskTool) GetDescription() string {
	return "Creates a new, independent task that will be processed separately. Provide a descriptive name, a short description (which becomes the initial prompt for the new task), and the full context (which becomes the system prompt for the new task). This new task must not conflict with or depend on the completion of the current task, as it may be started immediately by another process."
}

// GetXMLDefinition returns the XML structure for the LLM to use.
func (t *AddTaskTool) GetXMLDefinition() string {
	return `<tool id="add_task">{
  "name": "A concise and descriptive name for the new task.",
  "description": "A short description or initial prompt for the new task. This will be treated as the first user message to the new task.",
  "context": "The full context, detailed instructions, or system prompt for the new task. This should contain all necessary information for the new task to be understood and executed independently."
}</tool>`
}

// Execute constructs a sentinel string with the new task details.
// The actual task creation will be handled by the ToolDispatcher or TaskExecutor.
func (t *AddTaskTool) Execute(ctx context.Context, callDetails FunctionCall) (string, error) {
	if strings.TrimSpace(callDetails.Content) == "" {
		return "", fmt.Errorf("tool call content is empty, expected JSON arguments for add_task")
	}

	var args AddTaskArgs
	err := json.Unmarshal([]byte(callDetails.Content), &args)
	if err != nil {
		return "", fmt.Errorf("failed to unmarshal JSON arguments from content '%s' for add_task: %w", callDetails.Content, err)
	}

	if strings.TrimSpace(args.Name) == "" {
		return "", fmt.Errorf("missing required 'name' field in JSON arguments for add_task. Raw content: %s", callDetails.Content)
	}
	if strings.TrimSpace(args.Description) == "" {
		return "", fmt.Errorf("missing required 'description' field in JSON arguments for add_task. Raw content: %s", callDetails.Content)
	}
	if strings.TrimSpace(args.Context) == "" {
		return "", fmt.Errorf("missing required 'context' field in JSON arguments for add_task. Raw content: %s", callDetails.Content)
	}

	parentTaskID, ok := callDetails.Attributes["__task_id"]
	if !ok || parentTaskID == "" {
		// This should ideally not happen if ToolDispatcher injects it.
		// For robustness, we could allow creating tasks without a parent,
		// but the requirement is to have a reference.
		return "", fmt.Errorf("could not find parent task ID (__task_id) in attributes for add_task")
	}

	requestData := NewTaskRequestData{
		ParentTaskID: parentTaskID,
		Name:         args.Name,
		Description:  args.Description, // This will be the first user message
		SystemPrompt: args.Context,     // This will be the system prompt
	}

	requestDataBytes, err := json.Marshal(requestData)
	if err != nil {
		return "", fmt.Errorf("failed to marshal new task request data for add_task: %w", err)
	}

	return AddTaskSentinelPrefix + string(requestDataBytes), nil
}
