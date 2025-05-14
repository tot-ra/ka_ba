package llm

import (
	"context"
	"fmt"
	"io"
	"os" // Import os package
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

// ClientConfig holds configuration parameters for creating an LLMClient.
// Use a map for flexibility to support provider-specific parameters.
type ClientConfig map[string]interface{}

// NewClientFactory creates a new LLMClient based on the provider type, configuration, and environment variables.
func NewClientFactory(providerType string, config ClientConfig, envVars map[string]string) (LLMClient, error) {
	switch providerType {
	case "lmstudio":
		// Extract parameters for LMStudioClient from the config map
		apiURL, ok := config["apiURL"].(string)
		if !ok {
			return nil, fmt.Errorf("lmstudio config missing or invalid apiURL")
		}
		model, ok := config["model"].(string)
		if !ok {
			return nil, fmt.Errorf("lmstudio config missing or invalid model")
		}
		systemMessage, _ := config["systemMessage"].(string) // SystemMessage is optional
		maxContextLength, _ := config["maxContextLength"].(int) // maxContextLength is optional

		return NewLMStudioClient(apiURL, model, systemMessage, maxContextLength)

	case "google":
		// Extract parameters for GoogleClient from the config map
		apiKey, ok := config["apiKey"].(string)
		if !ok {
			// Check provided environment variables first
			apiKey, ok = envVars["GEMINI_API_KEY"]
			if !ok {
				// Fallback to process environment variables
				apiKey = os.Getenv("GEMINI_API_KEY")
				if apiKey == "" {
					return nil, fmt.Errorf("google config missing apiKey and GEMINI_API_KEY environment variable not set")
				}
			}
		}
		model, ok := config["model"].(string)
		if !ok {
			return nil, fmt.Errorf("google config missing or invalid model")
		}

		return NewGoogleClient(apiKey, model)

	default:
		return nil, fmt.Errorf("unsupported LLM provider type: %s", providerType)
	}
}
