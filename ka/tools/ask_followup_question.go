package tools

import (
	"context"
	"encoding/json"
	// "encoding/xml" // No longer needed for parsing content
	"fmt"
	"strings"
)

// AskFollowupQuestionTool prompts the user for more information.
type AskFollowupQuestionTool struct{}

// AskFollowupQuestionArgs defines the structure for the JSON arguments.
type AskFollowupQuestionArgs struct {
	Question string   `json:"question"`
	Options  []string `json:"options,omitempty"`
}

// GetName returns the name of the tool.
func (t *AskFollowupQuestionTool) GetName() string {
	return "ask_followup_question"
}

// GetDescription returns a description of the tool.
func (t *AskFollowupQuestionTool) GetDescription() string {
	return "Asks the user a question to gather additional information needed to complete the task. Use this when you encounter ambiguities, need clarification, or require more details to proceed effectively. The arguments should be provided as a JSON string within the tool tags."
}

// GetXMLDefinition returns the XML structure for the LLM to use.
// The LLM should place a JSON string as the content of the <tool> tag.
// The JSON string should represent an object with a "question" field (string)
// and an optional "options" field (array of strings).
func (t *AskFollowupQuestionTool) GetXMLDefinition() string {
	return `<tool id="ask_followup_question">{
  "question": "The question to ask the user. This should be a clear, specific question that addresses the information you need.",
  "options": ["Optional: Option 1", "Optional: Option 2"]
}</tool>`
}

// Execute asks the user a question and formats the output to include the [INPUT_REQUIRED] marker.
// callDetails.Content is expected to be a JSON string.
func (t *AskFollowupQuestionTool) Execute(ctx context.Context, callDetails FunctionCall) (string, error) {
	if strings.TrimSpace(callDetails.Content) == "" {
		return "", fmt.Errorf("tool call content is empty, expected JSON arguments")
	}

	var args AskFollowupQuestionArgs
	err := json.Unmarshal([]byte(callDetails.Content), &args)
	if err != nil {
		return "", fmt.Errorf("failed to unmarshal JSON arguments from content '%s': %w", callDetails.Content, err)
	}

	if strings.TrimSpace(args.Question) == "" {
		return "", fmt.Errorf("missing required 'question' field in JSON arguments. Raw content: %s", callDetails.Content)
	}

	var output strings.Builder
	output.WriteString(fmt.Sprintf("Question: %s\n", args.Question))

	if len(args.Options) > 0 {
		output.WriteString("Options:\n")
		for i, opt := range args.Options {
			output.WriteString(fmt.Sprintf("%d. %s\n", i+1, opt))
		}
	}

	output.WriteString("\n[INPUT_REQUIRED]") // Add a newline for better formatting before the marker
	return output.String(), nil
}
