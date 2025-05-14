package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
)

// ExecuteCommandParams defines the parameters for the ExecuteCommandTool.
type ExecuteCommandParams struct {
	Command string `json:"command"`
}

// ExecuteCommandTool implements the Tool interface for executing CLI commands.
type ExecuteCommandTool struct{}

func (t *ExecuteCommandTool) GetName() string {
	return "execute_command"
}

func (t *ExecuteCommandTool) GetDescription() string {
	return "Request to execute a CLI command on the system. Use this when you need to perform system operations or run specific commands to accomplish any step in the user's task if other tools cannot solve the issue. You must tailor your command to the user's system and provide a clear explanation of what the command does. For command chaining, use the appropriate chaining syntax for the user's shell. Prefer to execute complex CLI commands over creating executable scripts, as they are more flexible and easier to run. Commands will be executed in the current working directory. Avoid running commands that result in interactive mode."
}

func (t *ExecuteCommandTool) GetXMLDefinition() string {
	return `<tool id="execute_command">{"command": "your command here"}</tool>`
}

func (t *ExecuteCommandTool) Execute(ctx context.Context, callDetails FunctionCall) (string, error) {
	var params ExecuteCommandParams
	if err := json.Unmarshal([]byte(callDetails.Content), &params); err != nil {
		return "", fmt.Errorf("failed to parse arguments JSON for execute_command: %w. Content: %s", err, callDetails.Content)
	}

	if params.Command == "" {
		return "", fmt.Errorf("missing or invalid 'command' argument for execute_command")
	}

	// Get the user's default shell from the SHELL environment variable.
	shell := os.Getenv("SHELL")
	if shell == "" {
		// Fallback to a common shell if SHELL is not set
		shell = "/bin/sh"
	}

	// Execute the command and capture combined output (stdout and stderr).
	// The user's feedback overrides the .clinerules regarding piping to a log file.
	cmd := exec.CommandContext(ctx, shell, "-c", params.Command)

	output, err := cmd.CombinedOutput()
	if err != nil {
		// Include the command and output in the error for better debugging
		return "", fmt.Errorf("failed to execute command %q: %w\nOutput:\n%s", params.Command, err, string(output))
	}

	// Return the combined output as the result
	return string(output), nil
}
