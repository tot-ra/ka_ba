package tools

import (
	"context"
	"strings"
	"testing"
)

func TestComposeSystemPrompt(t *testing.T) {
	// Define mock available tools
	availableTools := map[string]Tool{
		"tool1": &MockTool{name: "tool1", description: "Description of tool1", xmlDefinition: "<tool1>...</tool1>"},
		"tool2": &MockTool{name: "tool2", description: "Description of tool2", xmlDefinition: "<tool2>...</tool2>"},
		"mcp":   &MockTool{name: "mcp", description: "Interact with MCP servers", xmlDefinition: "<use_mcp_tool>...</use_mcp_tool>"},
	}

	// Define mock MCP server configurations
	mockMcpServers := []McpServerConfig{
		{
			Name:    "server1",
			Command: "server1_command",
			Tools: []ToolDefinition{
				{Name: "server1_tool1", Description: "Tool 1 on server 1"},
				{Name: "server1_tool2", Description: "Tool 2 on server 1"},
			},
			Resources: []string{"resource1_uri", "resource2_uri"},
		},
		{
			Name:    "server2",
			Command: "server2_command",
			Tools:   []ToolDefinition{}, // Server with no tools
			Resources: []string{"resource3_uri"},
		},
	}

	tests := []struct {
		name              string
		selectedToolNames []string
		selectedMcpServers []McpServerConfig
		expectedSubstrings []string
		unexpectedSubstrings []string
	}{
		{
			name:              "No tools or MCP servers selected",
			selectedToolNames: []string{},
			selectedMcpServers: []McpServerConfig{},
			expectedSubstrings: []string{
				"IDENTITY",
				"OBJECTIVE",
				"COMMUNICATION STYLE",
				"TOOLS",
				"PLANNING",
				"CODING",
				"SYSTEM INFORMATION",
			},
			unexpectedSubstrings: []string{
				"## Tool \"tool1\"",
				"## Tool \"tool2\"",
				"## Tool \"mcp\"",
				"Connected MCP Servers:",
				"### server1",
				"### server2",
			},
		},
		{
			name:              "Only regular tools selected",
			selectedToolNames: []string{"tool1", "tool2"},
			selectedMcpServers: []McpServerConfig{},
			expectedSubstrings: []string{
				"## Tool \"tool1\"",
				"Description of tool1",
				"<tool1>...</tool1>",
				"## Tool \"tool2\"",
				"Description of tool2",
				"<tool2>...</tool2>",
			},
			unexpectedSubstrings: []string{
				"## Tool \"mcp\"",
				"Connected MCP Servers:",
				"### server1",
				"### server2",
			},
		},
		{
			name:              "Only MCP servers selected (with mcp tool)",
			selectedToolNames: []string{"mcp"},
			selectedMcpServers: mockMcpServers,
			expectedSubstrings: []string{
				"## Tool \"mcp\"",
				"Interact with MCP servers",
				"<use_mcp_tool>...</use_mcp_tool>",
				"Connected MCP Servers:",
				"### server1 (`server1_command`)",
				"#### Available Tools",
				"- server1_tool1: Tool 1 on server 1",
				"- server1_tool2: Tool 2 on server 1",
				"#### Available Resources",
				"- resource1_uri",
				"- resource2_uri",
				"### server2 (`server2_command`)",
				"#### Available Resources", // Server 2 only has resources
				"- resource3_uri",
			},
			unexpectedSubstrings: []string{
				"## Tool \"tool1\"",
				"## Tool \"tool2\"",
				// Should not list "Available Tools" section for server2 if it has none
				"### server2 (`server2_command`)\n\n#### Available Tools",
			},
		},
		{
			name:              "Both regular tools and MCP servers selected",
			selectedToolNames: []string{"tool1", "mcp"},
			selectedMcpServers: mockMcpServers,
			expectedSubstrings: []string{
				"## Tool \"tool1\"",
				"Description of tool1",
				"<tool1>...</tool1>",
				"## Tool \"mcp\"",
				"Connected MCP Servers:",
				"### server1 (`server1_command`)",
				"- server1_tool1: Tool 1 on server 1",
				"- resource1_uri",
				"### server2 (`server2_command`)",
				"- resource3_uri",
			},
			unexpectedSubstrings: []string{
				"## Tool \"tool2\"", // tool2 not selected
			},
		},
		{
			name:              "MCP tool selected but no MCP servers provided",
			selectedToolNames: []string{"mcp"},
			selectedMcpServers: []McpServerConfig{},
			expectedSubstrings: []string{
				"## Tool \"mcp\"",
				"Interact with MCP servers",
				"<use_mcp_tool>...</use_mcp_tool>",
			},
			unexpectedSubstrings: []string{
				"Connected MCP Servers:", // Should not list MCP servers section
				"### server1",
				"### server2",
			},
		},
		{
			name:              "Regular tools selected but no MCP servers provided",
			selectedToolNames: []string{"tool1"},
			selectedMcpServers: []McpServerConfig{},
			expectedSubstrings: []string{
				"## Tool \"tool1\"",
				"Description of tool1",
				"<tool1>...</tool1>",
			},
			unexpectedSubstrings: []string{
				"## Tool \"mcp\"",
				"Connected MCP Servers:",
				"### server1",
				"### server2",
			},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			composedPrompt := ComposeSystemPrompt(tt.selectedToolNames, tt.selectedMcpServers, availableTools)

			for _, expected := range tt.expectedSubstrings {
				if !strings.Contains(composedPrompt, expected) {
					t.Errorf("Expected substring not found in composed prompt:\n%s\n---\nComposed Prompt:\n%s", expected, composedPrompt)
				}
			}

			for _, unexpected := range tt.unexpectedSubstrings {
				if strings.Contains(composedPrompt, unexpected) {
					t.Errorf("Unexpected substring found in composed prompt:\n%s\n---\nComposed Prompt:\n%s", unexpected, composedPrompt)
				}
			}
		})
	}
}

// MockTool implements the Tool interface for testing purposes.
type MockTool struct {
	name          string
	description   string
	xmlDefinition string
}

func (m *MockTool) GetName() string {
	return m.name
}

func (m *MockTool) GetDescription() string {
	return m.description
}

func (m *MockTool) GetXMLDefinition() string {
	return m.xmlDefinition
}

func (m *MockTool) Execute(ctx context.Context, call FunctionCall) (string, error) {
	// Mock execution logic if needed for future tests, not required for ComposeSystemPrompt
	return "", nil
}
