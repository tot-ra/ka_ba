package a2a

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"ka/llm"
)

func TestBuildPromptFromInput(t *testing.T) {
	tests := []struct {
		name               string
		taskID             string
		inputMessages      []Message
		agentSystemMessage string
		wantMessages       []llm.Message
		wantContentFound   bool
		wantErr            bool
		errMsg             string
	}{
		{
			name:               "Empty input with system message",
			taskID:             "task1",
			inputMessages:      []Message{},
			agentSystemMessage: "System instructions",
			wantMessages: []llm.Message{
				{Role: "system", Content: "System instructions"},
			},
			wantContentFound: true,
			wantErr:          false,
		},
		{
			name:               "Empty input without system message",
			taskID:             "task2",
			inputMessages:      []Message{},
			agentSystemMessage: "",
			wantMessages:       nil,
			wantContentFound:   false,
			wantErr:            false,
		},
		{
			name:               "No user message",
			taskID:             "task3",
			inputMessages:      []Message{{Role: RoleAssistant, Parts: []Part{TextPart{Text: "Hello"}}}},
			agentSystemMessage: "",
			wantMessages:       nil,
			wantContentFound:   false,
			wantErr:            true,
			errMsg:             "input validation failed: no message with role 'user' found",
		},
		{
			name:   "Simple user and assistant messages",
			taskID: "task4",
			inputMessages: []Message{
				{Role: RoleUser, Parts: []Part{TextPart{Type: "text", Text: "Hello"}}},
				{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: "Hi there"}}},
			},
			agentSystemMessage: "Be helpful",
			wantMessages: []llm.Message{
				{Role: "system", Content: "Be helpful"},
				{Role: "user", Content: "Hello"},
				{Role: "assistant", Content: "Hi there"},
			},
			wantContentFound: true,
			wantErr:          false,
		},
		{
			name:   "Message with empty parts",
			taskID: "task5",
			inputMessages: []Message{
				{Role: RoleUser, Parts: []Part{}},
			},
			agentSystemMessage: "",
			wantMessages:       nil,
			wantContentFound:   false,
			wantErr:            true,
			errMsg:             "could not extract suitable prompt content from messages",
		},
		{
			name:   "Message with data part",
			taskID: "task6",
			inputMessages: []Message{
				{Role: RoleUser, Parts: []Part{DataPart{Type: "data", MimeType: "application/json"}}},
			},
			agentSystemMessage: "",
			wantMessages: []llm.Message{
				{Role: "user", Content: "[Data: application/json]"},
			},
			wantContentFound: true,
			wantErr:          false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			gotMessages, gotContentFound, err := buildPromptFromInput(tt.taskID, tt.inputMessages, tt.agentSystemMessage)

			// Check error
			if (err != nil) != tt.wantErr {
				t.Errorf("buildPromptFromInput() error = %v, wantErr %v", err, tt.wantErr)
				return
			}

			// Check error message if expected
			if tt.wantErr && err != nil && tt.errMsg != "" && err.Error() != tt.errMsg {
				t.Errorf("buildPromptFromInput() error message = %v, want %v", err.Error(), tt.errMsg)
			}

			// Check content found flag
			if gotContentFound != tt.wantContentFound {
				t.Errorf("buildPromptFromInput() contentFound = %v, want %v", gotContentFound, tt.wantContentFound)
			}

			// Check messages
			if !reflect.DeepEqual(gotMessages, tt.wantMessages) {
				t.Errorf("buildPromptFromInput() messages = %v, want %v", gotMessages, tt.wantMessages)
			}
		})
	}
}

func TestProcessFilePart(t *testing.T) {
	// Setup test HTTP server
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprintln(w, "Test file content")
	}))
	defer server.Close()

	tests := []struct {
		name     string
		taskID   string
		part     FilePart
		wantText string
		wantOK   bool
	}{
		{
			name:     "Invalid URI",
			taskID:   "task1",
			part:     FilePart{URI: "invalid://test.txt", MimeType: "text/plain"},
			wantText: "[Invalid File URI: invalid://test.txt]",
			wantOK:   false,
		},
		{
			name:     "File URI",
			taskID:   "task2",
			part:     FilePart{URI: "file:///test.txt", MimeType: "text/plain"},
			wantText: "[File: file:///test.txt (text/plain)]",
			wantOK:   true,
		},
		{
			name:     "HTTP URI",
			taskID:   "task3",
			part:     FilePart{URI: server.URL, MimeType: "text/plain"},
			wantText: fmt.Sprintf("[File Content from %s (text/plain)]:\nTest file content\n\n[/File Content]", server.URL),
			wantOK:   true,
		},
		{
			name:     "Data URI",
			taskID:   "task4",
			part:     FilePart{URI: "data:text/plain;base64,SGVsbG8gV29ybGQ=", MimeType: "text/plain"},
			wantText: "[Data Content (text/plain)]:\nHello World\n[/Data Content]",
			wantOK:   true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var builder strings.Builder
			gotOK := processFilePart(tt.taskID, tt.part, &builder)
			gotText := builder.String()

			if gotOK != tt.wantOK {
				t.Errorf("processFilePart() ok = %v, want %v", gotOK, tt.wantOK)
			}

			// For HTTP test, just check if it contains the expected content
			if tt.part.URI == server.URL {
				if !strings.Contains(gotText, "Test file content") {
					t.Errorf("processFilePart() text = %v, should contain 'Test file content'", gotText)
				}
			} else if gotText != tt.wantText {
				t.Errorf("processFilePart() text = %v, want %v", gotText, tt.wantText)
			}
		})
	}
}

func TestHasUserMessage(t *testing.T) {
	tests := []struct {
		name     string
		messages []Message
		want     bool
	}{
		{
			name:     "Empty messages",
			messages: []Message{},
			want:     false,
		},
		{
			name: "No user message",
			messages: []Message{
				{Role: RoleAssistant, Parts: []Part{TextPart{Text: "Hello"}}},
				{Role: RoleTool, Parts: []Part{TextPart{Text: "Tool output"}}},
			},
			want: false,
		},
		{
			name: "Has user message",
			messages: []Message{
				{Role: RoleAssistant, Parts: []Part{TextPart{Text: "Hello"}}},
				{Role: RoleUser, Parts: []Part{TextPart{Text: "User input"}}},
			},
			want: true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := hasUserMessage(tt.messages)
			if got != tt.want {
				t.Errorf("hasUserMessage() = %v, want %v", got, tt.want)
			}
		})
	}
}
