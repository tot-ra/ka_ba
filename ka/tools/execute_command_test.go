package tools

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
)

func TestExecuteCommandTool_Execute_Success(t *testing.T) {
	tool := &ExecuteCommandTool{}
	command := "echo 'hello world'"
	params := ExecuteCommandParams{Command: command}
	paramsJSON, _ := json.Marshal(params)

	callDetails := FunctionCall{
		Content: string(paramsJSON),
	}

	result, err := tool.Execute(context.Background(), callDetails)
	if err != nil {
		t.Fatalf("Execute failed: %v", err)
	}

	expectedOutput := "hello world\n" // echo adds a newline
	if result != expectedOutput {
		t.Errorf("Tool result mismatch. Expected:\n%q\nGot:\n%q", expectedOutput, result)
	}
}

func TestExecuteCommandTool_Execute_CommandNotFound(t *testing.T) {
	tool := &ExecuteCommandTool{}
	command := "non_existent_command_12345"
	params := ExecuteCommandParams{Command: command}
	paramsJSON, _ := json.Marshal(params)

	callDetails := FunctionCall{
		Content: string(paramsJSON),
	}

	_, err := tool.Execute(context.Background(), callDetails)
	if err == nil {
		t.Fatal("Execute did not return an error for a non-existent command")
	}

	expectedErrorSubstring := "failed to execute command"
	if !strings.Contains(err.Error(), expectedErrorSubstring) {
		t.Errorf("Error message does not contain expected substring %q. Got: %q", expectedErrorSubstring, err.Error())
	}
}

func TestExecuteCommandTool_Execute_MissingCommand(t *testing.T) {
	tool := &ExecuteCommandTool{}
	params := ExecuteCommandParams{Command: ""} // Missing command
	paramsJSON, _ := json.Marshal(params)

	callDetails := FunctionCall{
		Content: string(paramsJSON),
	}

	_, err := tool.Execute(context.Background(), callDetails)
	if err == nil {
		t.Fatal("Execute did not return an error for a missing command")
	}

	expectedError := "missing or invalid 'command' argument for execute_command"
	if err.Error() != expectedError {
		t.Errorf("Error message mismatch. Expected: %q, Got: %q", expectedError, err.Error())
	}
}

func TestExecuteCommandTool_Execute_InvalidJSON(t *testing.T) {
	tool := &ExecuteCommandTool{}
	callDetails := FunctionCall{
		Content: "{invalid json}", // Invalid JSON
	}

	_, err := tool.Execute(context.Background(), callDetails)
	if err == nil {
		t.Fatal("Execute did not return an error for invalid JSON")
	}

	expectedErrorSubstring := "failed to parse arguments JSON for execute_command"
	if !strings.Contains(err.Error(), expectedErrorSubstring) {
		t.Errorf("Error message does not contain expected substring %q. Got: %q", expectedErrorSubstring, err.Error())
	}
}
