package tools

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
)

// SearchFilesArgs defines the arguments for the search_files tool.
type SearchFilesArgs struct {
	Path        string  `json:"path"`
	Regex       string  `json:"regex"`
	FilePattern *string `json:"file_pattern,omitempty"`
}

// SearchFilesTool implements the Tool interface for searching files using ripgrep.
type SearchFilesTool struct{}

func (t *SearchFilesTool) GetName() string {
	return "search_files"
}

func (t *SearchFilesTool) GetDescription() string {
	return "Request to perform a regex search across files in a specified directory, providing context-rich results. Uses Rust regex syntax."
}

func (t *SearchFilesTool) GetXMLDefinition() string {
	return `<tool id="search_files">{"path": "path/to/directory", "regex": "your_regex_pattern", "file_pattern": "*.go" (optional)}</tool>`
}

func (t *SearchFilesTool) Execute(ctx context.Context, callDetails FunctionCall) (string, error) {
	var args SearchFilesArgs
	if err := json.Unmarshal([]byte(callDetails.Content), &args); err != nil {
		return "", fmt.Errorf("failed to parse arguments JSON from Content for search_files: %w. Content: %s", err, callDetails.Content)
	}

	if args.Path == "" {
		return "", fmt.Errorf("missing required 'path' argument for search_files")
	}
	if args.Regex == "" {
		return "", fmt.Errorf("missing required 'regex' argument for search_files")
	}

	cmdArgs := []string{"--json", "-e", args.Regex}

	if args.FilePattern != nil && *args.FilePattern != "" {
		cmdArgs = append(cmdArgs, "-g", *args.FilePattern)
	}
	cmdArgs = append(cmdArgs, args.Path)

	cmd := exec.CommandContext(ctx, "rg", cmdArgs...)

	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		// ripgrep exits with 1 if no matches are found, but still prints to stdout (empty JSON array or lines).
		// It exits with 2 for actual errors.
		// We should check stderr first. If stderr has content, it's likely an actual error.
		if stderr.Len() > 0 {
			return "", fmt.Errorf("ripgrep execution failed for search_files: %s. Stderr: %s", err, stderr.String())
		}
		// If stderr is empty but exit code is non-zero, it might be "no matches found" (exit code 1 for rg).
		// In this case, stdout (empty JSON array or similar) is still valid.
		// If it's another error (exit code 2), it's a problem.
		if exitErr, ok := err.(*exec.ExitError); ok && exitErr.ExitCode() > 1 {
			return "", fmt.Errorf("ripgrep execution error for search_files (exit code %d): %s. Stderr: %s", exitErr.ExitCode(), err, stderr.String())
		}
		// For exit code 0 or 1 with empty stderr, proceed with stdout.
	}
	
	// According to .clinerules, pipe output to tmp.log
	// This is slightly tricky as we want to return stdout to the caller,
	// but also log it. The current implementation returns stdout directly.
	// For now, I will return stdout and the user can decide if they want to log it
	// or if the .clinerules applies to the *agent's* execution of commands, not the tools themselves.
	// The prompt says "When you 'execute this command' tool, please always add piping of output to a logs file"
	// This tool is not "execute_command", it's a specific Go tool.
	// If rg itself needs to log, that's different.
	// The current implementation returns rg's JSON output.

	return stdout.String(), nil
}
