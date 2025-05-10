package tools

import (
	"context"
	"strings"
	"testing"
)

func TestAskFollowupQuestionTool_Execute(t *testing.T) {
	tool := &AskFollowupQuestionTool{}
	ctx := context.Background()

	tests := []struct {
		name          string
		callDetails   FunctionCall
		expected      string
		expectError   bool
		errorContains string
	}{
		{
			name: "Valid question and options",
			callDetails: FunctionCall{
				Name:    "ask_followup_question",
				Content: `{"question": "What is your favorite color?", "options": ["Red", "Green", "Blue"]}`,
			},
			expected: `Question: What is your favorite color?
Options:
1. Red
2. Green
3. Blue

[INPUT_REQUIRED]`,
			expectError: false,
		},
		{
			name: "Valid question, no options field",
			callDetails: FunctionCall{
				Name:    "ask_followup_question",
				Content: `{"question": "What is your name?"}`,
			},
			expected: `Question: What is your name?

[INPUT_REQUIRED]`,
			expectError: false,
		},
		{
			name: "Valid question, empty options array",
			callDetails: FunctionCall{
				Name:    "ask_followup_question",
				Content: `{"question": "Proceed?", "options": []}`,
			},
			expected: `Question: Proceed?

[INPUT_REQUIRED]`,
			expectError: false,
		},
		{
			name: "Valid question, options field is null (should be treated as empty)",
			callDetails: FunctionCall{
				Name:    "ask_followup_question",
				Content: `{"question": "Are you sure?", "options": null}`,
			},
			expected: `Question: Are you sure?

[INPUT_REQUIRED]`,
			expectError: false,
		},
		{
			name: "Malformed JSON",
			callDetails: FunctionCall{
				Name:    "ask_followup_question",
				Content: `{"question": "Choose one:", "options": ["Red", "Green", }`, // Missing closing bracket
			},
			expectError:   true,
			errorContains: "failed to unmarshal JSON arguments",
		},
		{
			name: "Missing question field",
			callDetails: FunctionCall{
				Name:    "ask_followup_question",
				Content: `{"options": ["Yes", "No"]}`,
			},
			expectError:   true,
			errorContains: "missing required 'question' field",
		},
		{
			name: "Empty question string",
			callDetails: FunctionCall{
				Name:    "ask_followup_question",
				Content: `{"question": "", "options": ["Yes", "No"]}`,
			},
			expectError:   true,
			errorContains: "missing required 'question' field",
		},
		{
			name: "Empty content string",
			callDetails: FunctionCall{
				Name:    "ask_followup_question",
				Content: ` `,
			},
			expectError:   true,
			errorContains: "tool call content is empty",
		},
		{
			name: "Question with special characters (JSON handles this naturally)",
			callDetails: FunctionCall{
				Name:    "ask_followup_question",
				Content: `{"question": "Is 5 < 10 and 10 > 5?", "options": ["Yes & No", "Maybe <or> Maybe Not"]}`,
			},
			expected: `Question: Is 5 < 10 and 10 > 5?
Options:
1. Yes & No
2. Maybe <or> Maybe Not

[INPUT_REQUIRED]`,
			expectError: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result, err := tool.Execute(ctx, tt.callDetails)

			if tt.expectError {
				if err == nil {
					t.Errorf("expected an error but got none")
				} else if tt.errorContains != "" && !strings.Contains(err.Error(), tt.errorContains) {
					t.Errorf("expected error to contain '%s', but got: %v", tt.errorContains, err)
				}
			} else {
				if err != nil {
					t.Errorf("did not expect an error but got: %v", err)
				}
				// Normalize newlines for comparison
				expectedNormalized := strings.ReplaceAll(tt.expected, "\r\n", "\n")
				resultNormalized := strings.ReplaceAll(result, "\r\n", "\n")

				if strings.TrimSpace(resultNormalized) != strings.TrimSpace(expectedNormalized) {
					t.Errorf("expected result:\n---\n%s\n---\nbut got:\n---\n%s\n---", expectedNormalized, resultNormalized)
				}
				if !strings.HasSuffix(resultNormalized, "[INPUT_REQUIRED]") {
					t.Errorf("expected result to end with [INPUT_REQUIRED], but got: %s", resultNormalized)
				}
			}
		})
	}
}

func TestAskFollowupQuestionTool_Getters(t *testing.T) {
	tool := &AskFollowupQuestionTool{}

	if tool.GetName() != "ask_followup_question" {
		t.Errorf("expected GetName() to be 'ask_followup_question', got '%s'", tool.GetName())
	}

	if tool.GetDescription() == "" {
		t.Error("expected GetDescription() to return a non-empty string")
	}
	if !strings.Contains(tool.GetDescription(), "JSON string") {
		t.Error("Description should mention JSON string arguments")
	}

	xmlDef := tool.GetXMLDefinition()
	if !strings.Contains(xmlDef, `<tool id="ask_followup_question"`) {
		t.Errorf("GetXMLDefinition() missing tool id: %s", xmlDef)
	}
	if !strings.Contains(xmlDef, `"question":`) {
		t.Errorf("GetXMLDefinition() example missing 'question' field: %s", xmlDef)
	}
	if !strings.Contains(xmlDef, `"options":`) {
		t.Errorf("GetXMLDefinition() example missing 'options' field: %s", xmlDef)
	}
}
