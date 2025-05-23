package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync" // Import sync for WaitGroup
)

// Define the structure for ToolDefinition to match the schema
type ToolDefinition struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	// Add input schema later if needed
}

// McpServerConfig represents the configuration for an MCP server.
type McpServerConfig struct {
	Name          string           `json:"name"`
	Timeout       int              `json:"timeout"`
	Command       string           `json:"command"`
	Args          []string         `json:"args"`
	TransportType string           `json:"transportType"` // Should be "stdio" for this tool
	Env           map[string]string `json:"env"`
	Tools         []ToolDefinition `json:"tools"`     // Added tools field
	Resources     []string         `json:"resources"` // Added resources field
}

// McpTool is a Tool implementation for interacting with MCP servers via stdio.
type McpTool struct{
	Configs map[string]McpServerConfig // Add field to store configurations (made public)
}

// SetConfigs updates the MCP server configurations for the McpTool.
func (t *McpTool) SetConfigs(configs map[string]McpServerConfig) {
	t.Configs = configs // Update reference
	log.Printf("[McpTool] Updated MCP server configurations. Loaded %d servers.", len(t.Configs)) // Update reference
}

// GetName returns the name of the MCP tool.
func (t *McpTool) GetName() string {
	return "mcp"
}

// GetDescription returns a description for the MCP tool.
func (t *McpTool) GetDescription() string {
	return "Use a tool or access a resource provided by a connected MCP server."
}

// GetXMLDefinition returns the XML definition for the MCP tool.
// Note: The actual prompt composition logic in prompt.go generates specific XML
// based on selected servers. This definition is more of a generic template
// for the Tool interface contract.
func (t *McpTool) GetXMLDefinition() string {
	var promptBuilder strings.Builder

	promptBuilder.WriteString(`MCP tool is more advanced than other tools as it uses MCP servers which have own tool and resoruce definitions. You can interact with specific MCP server tool using a "tool" attribute within tool tag.`)
	fmt.Fprintf(&promptBuilder, "Example format for using an MCP server tool:\n")
	fmt.Fprintf(&promptBuilder, "<tool id=\"mcp\" server=\"server name here\" tool=\"tool name here\">\n")
	fmt.Fprintf(&promptBuilder, "{\n")
	fmt.Fprintf(&promptBuilder, "  \"param1\": \"value1\",\n")
	fmt.Fprintf(&promptBuilder, "  \"param2\": \"value2\"\n")
	fmt.Fprintf(&promptBuilder, "}\n")
	fmt.Fprintf(&promptBuilder, "</tool>\n\n")

	fmt.Fprintf(&promptBuilder, "Example format for accessing an MCP resource:\n")
	fmt.Fprintf(&promptBuilder, "<tool id=\"mcp\" server=\"server name here\" resource=\"resource URI here\"></tool>\n")
	return promptBuilder.String()
}

// Execute performs the MCP tool action.
func (t *McpTool) Execute(ctx context.Context, callDetails FunctionCall) (string, error) {
	// Expected callDetails:
	// Name: "mcp"
	// Attributes: {"server": "server_name"}
	// Content: JSON object string for use_mcp_tool or access_mcp_resource

	serverName, ok := callDetails.Attributes["server"]
	if !ok || serverName == "" {
		return "", fmt.Errorf("mcp tool requires a 'server' attribute")
	}

	// --- 1. Use the stored MCP Server Configurations ---
	// Check if configurations have been set
	if t.Configs == nil || len(t.Configs) == 0 { // Update reference
		log.Printf("[McpTool] No MCP server configurations loaded.")
		return "", fmt.Errorf("no MCP server configurations loaded. Please configure the agent.")
	}

	// --- 2. Find the specified MCP Server Configuration ---
	serverConfig, ok := t.Configs[serverName] // Update reference
	if !ok {
		log.Printf("[McpTool] MCP server configuration not found for name: %s", serverName)
		return "", fmt.Errorf("mcp server configuration not found for '%s'", serverName)
	}

	if serverConfig.TransportType != "stdio" {
		log.Printf("[McpTool] Unsupported transport type for MCP server %s: %s", serverName, serverConfig.TransportType)
		return "", fmt.Errorf("unsupported transport type for MCP server '%s': %s (only 'stdio' is supported)", serverName, serverConfig.TransportType)
	}

	log.Printf("[McpTool] Found config for server '%s': Command='%s', Args='%v'", serverName, serverConfig.Command, serverConfig.Args)

	// --- 3. Parse the JSON content to determine action (tool or resource) ---
	var actionPayload map[string]json.RawMessage
	if err := json.Unmarshal([]byte(callDetails.Content), &actionPayload); err != nil {
		log.Printf("[McpTool] Error unmarshalling tool call content JSON: %v, Content: %s", err, callDetails.Content)
		return "", fmt.Errorf("invalid JSON content for MCP tool call: %w", err)
	}

	var jsonRPCRequestPayload []byte // The JSON-RPC request to send to the MCP server

	if toolNameRaw, ok := actionPayload["tool_name"]; ok {
		// It's a tool usage request
		var toolName string
		if err := json.Unmarshal(toolNameRaw, &toolName); err != nil {
			log.Printf("[McpTool] Error unmarshalling tool_name: %v", err)
			return "", fmt.Errorf("invalid 'tool_name' in MCP tool call content: %w", err)
		}

		argumentsRaw, ok := actionPayload["arguments"]
		if !ok {
			return "", fmt.Errorf("'arguments' field is required for MCP tool usage")
		}

		// Construct the JSON-RPC request for tool usage
		jsonRPCRequestPayload, err := json.Marshal(map[string]interface{}{
			"jsonrpc": "2.0",
			"method":  "use_tool", // Standard MCP method for tool usage
			"params": map[string]interface{}{
				"tool_name": toolName,
				"arguments": json.RawMessage(argumentsRaw), // Keep arguments as raw JSON
			},
			"id": "tool-call-id", // TODO: Generate a unique ID or use task/message ID
		})
		if err != nil {
			log.Printf("[McpTool] Error marshalling use_tool JSON-RPC request: %v", err)
			return "", fmt.Errorf("failed to construct MCP tool usage request: %w", err)
		}
		log.Printf("[McpTool] Constructed use_tool JSON-RPC request: %s", string(jsonRPCRequestPayload))

	} else if resourceURIRaw, ok := actionPayload["resource_uri"]; ok {
		// It's a resource access request
		var resourceURI string
		if err := json.Unmarshal(resourceURIRaw, &resourceURI); err != nil {
			log.Printf("[McpTool] Error unmarshalling resource_uri: %v", err)
			return "", fmt.Errorf("invalid 'resource_uri' in MCP tool call content: %w", err)
		}

		// Construct the JSON-RPC request for resource access
		jsonRPCRequestPayload, err := json.Marshal(map[string]interface{}{
			"jsonrpc": "2.0",
			"method":  "access_resource", // Standard MCP method for resource access
			"params": map[string]interface{}{
				"uri": resourceURI,
			},
			"id": "resource-access-id", // TODO: Generate a unique ID or use task/message ID
		})
		if err != nil {
			log.Printf("[McpTool] Error marshalling access_resource JSON-RPC request: %v", err)
			return "", fmt.Errorf("failed to construct MCP resource access request: %w", err)
		}
		log.Printf("[McpTool] Constructed access_resource JSON-RPC request: %s", string(jsonRPCRequestPayload))

	} else {
		// Invalid content
		return "", fmt.Errorf("invalid content for MCP tool call: expected 'tool_name' or 'resource_uri'")
	}


	// --- 4. Execute the MCP Server Process and Communicate via Stdio ---
	cmd := exec.CommandContext(ctx, serverConfig.Command, serverConfig.Args...)

	// Set environment variables
	cmd.Env = os.Environ() // Inherit current environment
	for key, value := range serverConfig.Env {
		cmd.Env = append(cmd.Env, fmt.Sprintf("%s=%s", key, value))
	}

	// Setup stdin and stdout pipes
	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		log.Printf("[McpTool] Error creating stdin pipe for %s: %v", serverName, err)
		return "", fmt.Errorf("failed to create stdin pipe for MCP server '%s': %w", serverName, err)
	}
	stdoutPipe, err := cmd.StdoutPipe()
	if err != nil {
		log.Printf("[McpTool] Error creating stdout pipe for %s: %v", serverName, err)
		return "", fmt.Errorf("failed to create stdout pipe for MCP server '%s': %w", serverName, err)
	}

	// Start the process
	log.Printf("[McpTool] Starting MCP server process: %s %v", serverConfig.Command, serverConfig.Args)
	if err := cmd.Start(); err != nil {
		log.Printf("[McpTool] Error starting MCP server process %s: %v", serverConfig.Command, err)
		return "", fmt.Errorf("failed to start MCP server process '%s': %w", serverConfig.Command, err)
	}
	log.Printf("[McpTool] MCP server process started successfully (PID: %d)", cmd.Process.Pid)


	// Use a WaitGroup to wait for both writing to stdin and reading from stdout to finish
	var wg sync.WaitGroup
	var stdoutContent strings.Builder
	var writeErr, readErr error

	// Goroutine to write the JSON-RPC request payload to the process's stdin
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer stdinPipe.Close() // Close stdin pipe when done writing

		log.Printf("[McpTool] Writing %d bytes to MCP server stdin...", len(jsonRPCRequestPayload))
		_, writeErr = io.WriteString(stdinPipe, string(jsonRPCRequestPayload) + "\n") // Add newline for line-based transports
		if writeErr != nil {
			log.Printf("[McpTool] Error writing to MCP server stdin: %v", writeErr)
		} else {
			log.Printf("[McpTool] Finished writing to MCP server stdin.")
		}
	}()

	// Goroutine to read the process's stdout
	wg.Add(1)
	go func() {
		defer wg.Done()
		defer stdoutPipe.Close() // Close stdout pipe when done reading

		log.Printf("[McpTool] Reading from MCP server stdout...")
		// Read until EOF or context cancellation
		readBytes, readErr := io.ReadAll(stdoutPipe)
		if readErr != nil {
			log.Printf("[McpTool] Error reading from MCP server stdout: %v", readErr)
		} else {
			stdoutContent.Write(readBytes)
			log.Printf("[McpTool] Finished reading from MCP server stdout. Read %d bytes.", len(readBytes))
		}
	}()

	// Wait for writing and reading goroutines to finish
	wg.Wait()

	// Wait for the process to exit
	log.Printf("[McpTool] Waiting for MCP server process to exit...")
	waitErr := cmd.Wait()
	log.Printf("[McpTool] MCP server process exited. Wait error: %v", waitErr)


	// Check for errors during writing, reading, or waiting
	if writeErr != nil {
		return "", fmt.Errorf("error writing to MCP server stdin: %w", writeErr)
	}
	if readErr != nil {
		return "", fmt.Errorf("error reading from MCP server stdout: %w", readErr)
	}
	if waitErr != nil {
		// If the process exited with a non-zero status, treat it as an error
		if exitErr, ok := waitErr.(*exec.ExitError); ok {
			log.Printf("[McpTool] MCP server process exited with non-zero status: %d, Stderr: %s", exitErr.ExitCode(), string(exitErr.Stderr))
			// Include stdout content even on error, as it might contain useful info
			return stdoutContent.String(), fmt.Errorf("mcp server process exited with status %d. Stderr: %s", exitErr.ExitCode(), string(exitErr.Stderr))
		}
		// Other wait errors (e.g., context cancellation)
		return stdoutContent.String(), fmt.Errorf("error waiting for MCP server process: %w", waitErr)
	}

	log.Printf("[McpTool] MCP server process completed successfully.")

	// Return the content read from stdout
	return stdoutContent.String(), nil
}
