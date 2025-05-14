package llm

import (
	"context"
	"fmt"
	"io"
)

type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type Request struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Temperature float32   `json:"temperature"`
	MaxTokens   int       `json:"max_tokens"`
	Stream      bool      `json:"stream"`
}

// LLMClient interface
type LLMClient interface {
	Chat(ctx context.Context, messages []Message, stream bool, out io.Writer) (string, int, int, error)
	// Add other common methods here if needed universally
}

// NewClientFactory creates a new LLMClient based on the provider type.
func NewClientFactory(providerType string, apiURL, model, systemMessage string, maxContextLength int) (LLMClient, error) {
	switch providerType {
	case "lmstudio":
		return NewLMStudioClient(apiURL, model, systemMessage, maxContextLength)
	// Add cases for other providers here
	default:
		return nil, fmt.Errorf("unsupported LLM provider type: %s", providerType)
	}
}
