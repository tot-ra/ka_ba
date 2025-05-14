package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log" // Import log package
	"net/http"
	"os" // Import os to get API key from environment variable
)

// GoogleClient implements the LLMClient interface for the Google Gemini API.
type GoogleClient struct {
	APIKey string
	Model  string
	// Google API handles system instructions differently, often as a separate field in the request
	// or as the first message with a specific role. We'll need to check their docs.
	// For now, we won't include a SystemMessage field here, and will handle it in the Chat method.
}

// NewGoogleClient creates a new GoogleClient.
// It expects the API key to be provided.
func NewGoogleClient(apiKey, model string) (*GoogleClient, error) {
	log.Printf("[NewGoogleClient] Received apiKey argument: %s", apiKey)
	envAPIKey := os.Getenv("GEMINI_API_KEY")
	log.Printf("[NewGoogleClient] GEMINI_API_KEY from environment: %s", envAPIKey)

	if apiKey == "" {
		// Attempt to get API key from environment variable if not provided
		apiKey = envAPIKey
		if apiKey == "" {
			return nil, fmt.Errorf("Google API key is required and not found in GEMINI_API_KEY environment variable")
		}
	}
	log.Printf("[NewGoogleClient] Using API Key: %s", apiKey)

	if model == "" {
		model = "gemini-2.5-pro-preview-05-06" // Default model if not provided
	}

	return &GoogleClient{
		APIKey: apiKey,
		Model:  model,
	}, nil
}

// Chat sends the provided messages to the Google Gemini API and returns the completion.
// The Google API uses a different message structure ("contents" with "parts").
// We need to convert the generic []Message to the Google-specific format.
func (c *GoogleClient) Chat(ctx context.Context, messages []Message, stream bool, out io.Writer) (string, int, int, error) {
	// Convert generic messages to Google's "contents" format
	googleContents := []map[string]interface{}{}
	for _, msg := range messages {
		// Google API roles might be different (e.g., "user", "model").
		// We might need to map our generic roles ("user", "assistant", "system")
		// to Google's roles. The curl example shows "user". Let's assume "user" and "model" for now.
		googleRole := msg.Role
		if googleRole == "assistant" {
			googleRole = "model" // Map "assistant" to "model" for Google
		} else if googleRole == "system" {
			// Google often handles system instructions separately or as a specific first message.
			// For simplicity now, we'll include system messages as user messages,
			// but this might need refinement based on actual API documentation.
			googleRole = "user"
		}

		googleContents = append(googleContents, map[string]interface{}{
			"role": googleRole,
			"parts": []map[string]string{
				{"text": msg.Content},
			},
		})
	}

	// Construct the request body
	requestBody := map[string]interface{}{
		"contents": googleContents,
		// Add other parameters like temperature, max_tokens if needed and supported by the interface
		// "temperature": 0.6, // Example
		// "max_tokens": 100, // Example
	}

	payload, err := json.Marshal(requestBody)
	if err != nil {
		return "", 0, 0, fmt.Errorf("failed to marshal request body: %w", err)
	}

	// Construct the API URL with the model and API key
	// The model is part of the URL path for Google API
	apiURL := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models/%s:generateContent?key=%s", c.Model, c.APIKey)

	fmt.Printf("Sending request to Google API (%s) with payload: %s\n", apiURL, string(payload))

	// Create and send HTTP request
	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBuffer(payload))
	if err != nil {
		return "", 0, 0, fmt.Errorf("failed to create HTTP request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", 0, 0, fmt.Errorf("failed to send HTTP request: %w", err)
	}
	defer resp.Body.Close()

	fmt.Printf("Received response from Google API with status code: %d\n", resp.StatusCode)

	if resp.StatusCode != 200 {
		bodyBytes, readErr := io.ReadAll(resp.Body)
		errorMsg := fmt.Sprintf("Google API returned status %d", resp.StatusCode)
		if readErr == nil && len(bodyBytes) > 0 {
			errorMsg = fmt.Sprintf("%s: %s", errorMsg, string(bodyBytes))
		}
		return "", 0, 0, fmt.Errorf(errorMsg)
	}

	// Handle the response
	// Google API response structure is different. We need to parse it.
	// Example response structure (simplified):
	// {
	//   "candidates": [
	//     {
	//       "content": {
	//         "parts": [
	//           {
	//             "text": "..."
	//           }
	//         ],
	//         "role": "model"
	//       },
	//       "finishReason": "STOP",
	//       "index": 0
	//     }
	//   ],
	//   "promptFeedback": { ... }
	// }

	var googleResponse struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", 0, 0, fmt.Errorf("failed to read response body: %w", err)
	}

	fmt.Printf("Google API Response Body: %s\n", string(bodyBytes))

	if err := json.Unmarshal(bodyBytes, &googleResponse); err != nil {
		return "", 0, 0, fmt.Errorf("failed to unmarshal Google API response: %w", err)
	}

	completionText := ""
	if len(googleResponse.Candidates) > 0 && len(googleResponse.Candidates[0].Content.Parts) > 0 {
		completionText = googleResponse.Candidates[0].Content.Parts[0].Text
	}

	// Write the completion text to the output writer
	if _, writeErr := out.Write([]byte(completionText)); writeErr != nil {
		log.Printf("Error writing Google API completion to output: %v", writeErr)
	}

	// Token counting for Google API requires calling a separate countTokens endpoint.
	// For now, we will return 0 for token counts. This needs to be implemented later.
	inputTokens := 0
	completionTokens := 0

	return completionText, inputTokens, completionTokens, nil
}

// Note: Streaming for Google Gemini API is different and requires using the generateContent method
// with a different endpoint suffix (e.g., :streamGenerateContent).
// The current implementation of Chat assumes a single endpoint for both streaming and non-streaming,
// which works for OpenAI-compatible APIs but not directly for Google.
// A more robust solution would involve checking the 'stream' flag and using the appropriate Google endpoint and response parsing logic.
// For this initial implementation, we are only handling the non-streaming case based on the provided curl example.
// The 'stream' parameter is currently ignored in the GoogleClient's Chat method.
