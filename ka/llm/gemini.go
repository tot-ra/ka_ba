package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
)

// GeminiClient is an LLM client for Google Gemini.
type GeminiClient struct {
	APIKey string
	Model  string
	// Add other Gemini-specific fields here if needed
}

// NewGeminiClient creates a new GeminiClient.
func NewGeminiClient(apiKey, model string) *GeminiClient {
	return &GeminiClient{
		APIKey: apiKey,
		Model:  model,
	}
}

// Chat sends the provided messages to the Gemini LLM and returns the completion, input tokens, completion tokens, and error.
func (c *GeminiClient) Chat(ctx context.Context, messages []Message, stream bool, out io.Writer) (string, int, int, error) {
	// Gemini API uses a different message structure and endpoint
	// The base URL is typically https://generativelanguage.googleapis.com/v1beta/models/
	apiBaseURL := "https://generativelanguage.googleapis.com/v1beta/models/"
	apiURL := fmt.Sprintf("%s%s:generateContent?key=%s", apiBaseURL, c.Model, c.APIKey)

	// Convert internal Message format to Gemini's format
	geminiMessages := []map[string]interface{}{}
	for _, msg := range messages {
		// Gemini uses "user" and "model" roles, and "parts" with "text"
		role := msg.Role
		if role == "assistant" {
			role = "model"
		}
		geminiMessages = append(geminiMessages, map[string]interface{}{
			"role": role,
			"parts": []map[string]string{
				{"text": msg.Content},
			},
		})
	}

	requestBody := map[string]interface{}{
		"contents": geminiMessages,
		// Add other parameters like temperature, max_output_tokens if needed
	}

	payload, err := json.Marshal(requestBody)
	if err != nil {
		return "", 0, 0, err // Return 0 for token counts on error
	}

	fmt.Printf("Sending request to %s with payload: %s\n", apiURL, string(payload))

	// Create and send HTTP request
	req, err := http.NewRequestWithContext(ctx, "POST", apiURL, bytes.NewBuffer(payload))
	if err != nil {
		return "", 0, 0, err // Return 0 for token counts on error
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", 0, 0, err // Return 0 for token counts on error
	}
	defer resp.Body.Close()

	fmt.Fprintln(out, "Received response header.")
	fmt.Printf("Received response with status code: %d\n", resp.StatusCode)

	if resp.StatusCode != 200 {
		return "", 0, 0, c.handleErrorResponse(resp) // Return 0 for token counts on error
	}

	if stream {
		// TODO: Implement streaming response handling for Gemini
		fmt.Fprintln(out, "Gemini streaming is not yet fully implemented, falling back to non-streaming.")
		return c.handleNonStreamingResponse(resp, out)
	} else {
		return c.handleNonStreamingResponse(resp, out)
	}
}

// UpdateSystemMessage updates the system message for the Gemini client.
func (c *GeminiClient) UpdateSystemMessage(newSystemMessage string) {
	// Gemini handles system instructions differently, often as a separate parameter
	// or within the initial prompt. This client currently doesn't support a separate
	// system message update after initialization.
	fmt.Printf("GeminiClient received system message update: %s (handling not yet implemented)\n", newSystemMessage)
}

// handleErrorResponse processes error responses from the API
func (c *GeminiClient) handleErrorResponse(resp *http.Response) error {
	bodyBytes, readErr := io.ReadAll(resp.Body)
	errorMsg := fmt.Sprintf("Gemini API returned status %d", resp.StatusCode)
	if readErr == nil && len(bodyBytes) > 0 {
		errorMsg = fmt.Sprintf("%s: %s", errorMsg, string(bodyBytes))
	}
	return fmt.Errorf(errorMsg)
}

// handleNonStreamingResponse processes non-streaming responses
func (c *GeminiClient) handleNonStreamingResponse(resp *http.Response, out io.Writer) (string, int, int, error) {
	fmt.Fprintln(out, "Attempting to read response body...")

	// Read the entire response
	buffer := bytes.Buffer{}
	reader := io.Reader(resp.Body)
	buf := make([]byte, 1024)
	for {
		n, err := reader.Read(buf)
		if n > 0 {
			buffer.Write(buf[:n])
		}
		if err != nil {
			if err == io.EOF {
				break
			}
			return "", 0, 0, fmt.Errorf("reading non-streaming response body: %w", err) // Return 0 for token counts on error
		}
	}
	respBody := buffer.Bytes()

	fmt.Fprintln(out, "Finished reading response body.")
	fmt.Fprintln(out, "Raw Response Body:")
	fmt.Fprintln(out, string(respBody))

	// Try to parse the response
	var parsed struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}

	fmt.Printf("Response Body: %s\n", string(respBody))
	completionText := ""
	// Note: Token counting for Gemini responses is not implemented here.
	inputTokens := 0 // Placeholder
	completionTokens := 0 // Placeholder

	if err := json.Unmarshal(respBody, &parsed); err == nil && len(parsed.Candidates) > 0 && len(parsed.Candidates[0].Content.Parts) > 0 {
		completionText = parsed.Candidates[0].Content.Parts[0].Text

		fmt.Fprintln(out, "Parsed Response Content:")
		fmt.Fprintln(out, completionText)
		// fmt.Printf("Non-streaming completion tokens: %d\n", completionTokens) // Token counting not implemented
	} else {
		fmt.Fprintln(out, "Failed to parse response body.")
		completionText = string(respBody)
		// completionTokens = c.getTokenLength(completionText) // Token counting not implemented
		// fmt.Printf("Non-streaming completion tokens (unparsed body): %d\n", completionTokens) // Token counting not implemented
	}

	return completionText, inputTokens, completionTokens, nil // Return placeholder token counts
}
