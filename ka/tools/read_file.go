package tools

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
)

// ReadFileParams defines the parameters for the ReadFileTool.
type ReadFileParams struct {
	Path     string `json:"path"`
	FromLine int    `json:"from_line"`
	ToLine   *int   `json:"to_line"`
}

// ReadFileTool implements the Tool interface for reading files.
type ReadFileTool struct{}

func (t *ReadFileTool) GetName() string {
	return "read_file"
}

func (t *ReadFileTool) GetDescription() string {
	return "Reads the contents of a file at the specified path. Can read a specific line range. By default, reads from line 0 to line 200. It's recommended to read files partially if possible."
}

func (t *ReadFileTool) GetXMLDefinition() string {
	return `<tool id="read_file">{"path": "path/to/file", "from_line": 0, "to_line": 200 (optional, omit or null to read entire file from from_line)}</tool>`
}

func (t *ReadFileTool) Execute(ctx context.Context, callDetails FunctionCall) (string, error) {
	var params ReadFileParams
	// Set default ToLine before unmarshalling
	defaultToLine := 200
	params.ToLine = &defaultToLine

	if err := json.Unmarshal([]byte(callDetails.Content), &params); err != nil {
		return "", fmt.Errorf("failed to parse arguments JSON for read_file: %w. Content: %s", err, callDetails.Content)
	}

	if params.Path == "" {
		return "", fmt.Errorf("missing or invalid 'path' argument for read_file. Parsed params: %+v", params)
	}

	file, err := os.Open(params.Path)
	if err != nil {
		return "", fmt.Errorf("failed to open file %q: %w", params.Path, err)
	}
	defer file.Close()

	reader := bufio.NewReader(file)
	var lines []string
	currentLine := 0

	for {
		line, err := reader.ReadString('\n')
		if err != nil && err != io.EOF {
			return "", fmt.Errorf("failed to read line from file %q: %w", params.Path, err)
		}

		if currentLine >= params.FromLine {
			if params.ToLine == nil || currentLine < *params.ToLine {
				lines = append(lines, line)
			} else if params.ToLine != nil && currentLine >= *params.ToLine {
				break 
			}
		}

		currentLine++
		if err == io.EOF {
			break
		}
	}
	
	if params.ToLine != nil {
		expectedLinesCount := *params.ToLine - params.FromLine
		if expectedLinesCount <= 0 {
			// This case implies FromLine >= ToLine, or ToLine is 0 and FromLine is 0.
			// The loop should have already resulted in an empty 'lines' slice or very few lines.
			// We explicitly set lines to empty to ensure correctness.
			lines = []string{}
		} else if len(lines) > expectedLinesCount {
			// This handles cases where EOF was hit late or loop collected slightly more.
			lines = lines[:expectedLinesCount]
		}
		// If len(lines) <= expectedLinesCount, no trimming is needed.
		// This also correctly handles cases where fewer lines were read than expectedLinesCount (e.g. EOF).
	}

	return strings.Join(lines, ""), nil
}
