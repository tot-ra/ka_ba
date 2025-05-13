package llm

import (
	"bufio" // Added for reading stream line by line
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log" // Added for logging warnings/errors
	"net/http"
	"strings"

	"github.com/pkoukk/tiktoken-go"
)

// Message represents a message in a conversation.
type Message struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// LLM is an interface that represents a Large Language Model client.
type LLM interface {
	// Chat sends the provided messages to the LLM and returns the completion, input tokens, completion tokens, and error.
	Chat(ctx context.Context, messages []Message, stream bool, out io.Writer) (string, int, int, error)
	// UpdateSystemMessage updates the system message for the LLM client.
	UpdateSystemMessage(newSystemMessage string)
}

// OpenAIClient is an LLM client for OpenAI-compatible APIs.
type OpenAIClient struct {
	APIURL           string
	Model            string
	SystemMessage    string
	MaxContextLength int
	tokenizer        *tiktoken.Tiktoken
}

// Request represents a request to an OpenAI-compatible API.
type Request struct {
	Model       string    `json:"model"`
	Messages    []Message `json:"messages"`
	Temperature float32   `json:"temperature"`
	MaxTokens   int       `json:"max_tokens"`
	Stream      bool      `json:"stream"`
}

// NewOpenAIClient creates a new OpenAIClient.
func NewOpenAIClient(apiURL, model string, systemMessage string, maxContextLength int) *OpenAIClient {
	// Attempt to get the encoding for the specific model.
	tkm, err := tiktoken.EncodingForModel(model)
	if err != nil {
		fmt.Printf("Warning: Could not get encoding for model '%s', falling back to 'cl100k_base'. Error: %v\n", model, err)
		// Fallback to a default encoding if the specific model is not found.
		tkm, err = tiktoken.GetEncoding("cl100k_base")
		if err != nil {
			// If even the fallback fails, panic is appropriate as token counting is critical.
			panic(fmt.Sprintf("Failed to get fallback tiktoken encoding 'cl100k_base': %v", err))
		}
	}
	return &OpenAIClient{
		APIURL:           apiURL,
		Model:            model,
		SystemMessage:    systemMessage, // Store the system message
		MaxContextLength: maxContextLength,
		tokenizer:        tkm,
	}
}

// NewLLM creates and returns an LLM client based on the provider type.
func NewLLM(providerType, apiURL, model, apiKey, systemMessage string, maxContextLength int) (LLM, error) {
	switch providerType {
	case "openai":
		return NewOpenAIClient(apiURL, model, systemMessage, maxContextLength), nil
	case "gemini":
		// Assuming APIKey is needed for Gemini
		return NewGeminiClient(apiKey, model), nil
	default:
		return nil, fmt.Errorf("unsupported LLM provider type: %s", providerType)
	}
}

// UpdateSystemMessage updates the system message for the OpenAI client.
func (c *OpenAIClient) UpdateSystemMessage(newSystemMessage string) {
	c.SystemMessage = newSystemMessage
	fmt.Printf("OpenAIClient system message updated to: %s\n", newSystemMessage)
}

// getTokenLength uses the client's specific tiktoken tokenizer to count tokens.
func (c *OpenAIClient) getTokenLength(text string) int {
	if c.tokenizer == nil {
		// Should not happen due to logic in NewOpenAIClient, but good practice.
		fmt.Println("Error: Tokenizer not initialized for OpenAIClient.")
		// Returning a high number might be safer than 0 if this somehow occurs,
		// to prevent accidentally exceeding context limits.
		return len(text) // Fallback to character count as a rough upper bound.
	}
	tokens := c.tokenizer.Encode(text, nil, nil)
	return len(tokens)
}

// Chat sends the provided messages to the OpenAI-compatible LLM and returns the completion, input tokens, completion tokens, and error.
func (c *OpenAIClient) Chat(ctx context.Context, messages []Message, stream bool, out io.Writer) (string, int, int, error) {
	// Prepare messages with system message
	messagesWithSystem := c.prepareMessages(messages)

	// Calculate token usage and handle truncation if needed
	finalInputTokens, truncatedMessages := c.handleContextLimits(messagesWithSystem)

	// Create and send the request
	completion, completionTokens, err := c.sendRequest(ctx, truncatedMessages, stream, out)

	return completion, finalInputTokens, completionTokens, err
}

// prepareMessages adds the system message to the provided messages
func (c *OpenAIClient) prepareMessages(messages []Message) []Message {
	systemMessage := Message{
		Role:    "system",
		Content: c.SystemMessage,
	}
	return append([]Message{systemMessage}, messages...)
}

// handleContextLimits calculates token usage and truncates messages if needed
func (c *OpenAIClient) handleContextLimits(messages []Message) (int, []Message) {
	inputTokenLength := 0
	for _, message := range messages {
		inputTokenLength += c.getTokenLength(message.Content)
	}
	fmt.Printf("Current context length: %d tokens\n", inputTokenLength)

	// Store original token count before any truncation
	finalInputTokens := inputTokenLength

	// Only truncate if we have a context limit and we exceed it
	if c.MaxContextLength > 0 && inputTokenLength > c.MaxContextLength {
		messages = c.truncateMessages(messages, inputTokenLength)
	}

	return finalInputTokens, messages
}

// truncateMessages reduces the message list to fit within context limits
func (c *OpenAIClient) truncateMessages(messages []Message, inputTokenLength int) []Message {
	fmt.Printf("Context length exceeds maximum allowed length of %d tokens. Truncating messages.\n", c.MaxContextLength)

	// Find the index of the last system message
	lastSystemIndex := -1
	for i, msg := range messages {
		if msg.Role == "system" {
			lastSystemIndex = i
		}
	}

	// First truncate non-system messages from the end
	currentLength := inputTokenLength
	for currentLength > c.MaxContextLength && len(messages) > lastSystemIndex+1 {
		removedMsg := messages[len(messages)-1]
		messages = messages[:len(messages)-1]
		currentLength -= c.getTokenLength(removedMsg.Content)
		fmt.Printf("Truncated message. New context length: %d tokens\n", currentLength)
	}

	// If still too long, truncate system messages (rare case)
	for currentLength > c.MaxContextLength && len(messages) > 0 {
		removedMsg := messages[0]
		messages = messages[1:]
		currentLength -= c.getTokenLength(removedMsg.Content)
		fmt.Printf("Truncated system message. New context length: %d tokens\n", currentLength)
	}

	return messages
}

// sendRequest creates and sends the API request, handling both streaming and non-streaming responses
func (c *OpenAIClient) sendRequest(ctx context.Context, messages []Message, stream bool, out io.Writer) (string, int, error) {
	request := Request{
		Model:       c.Model,
		Messages:    messages,
		Temperature: 0.7,
		MaxTokens:   -1,
		Stream:      stream,
	}

	payload, err := json.Marshal(request)
	if err != nil {
		return "", 0, err
	}

	fmt.Printf("Sending request to %s with payload: %s\n", c.APIURL, string(payload))

	// Create and send HTTP request
	req, err := http.NewRequestWithContext(ctx, "POST", c.APIURL, bytes.NewBuffer(payload))
	if err != nil {
		return "", 0, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", 0, err
	}
	defer resp.Body.Close()

	fmt.Fprintln(out, "Received response header.")
	fmt.Printf("Received response with status code: %d\n", resp.StatusCode)

	if resp.StatusCode != 200 {
		return "", 0, c.handleErrorResponse(resp)
	}

	if stream {
		return c.handleStreamingResponse(resp, out)
	} else {
		return c.handleNonStreamingResponse(resp, out)
	}
}

// handleErrorResponse processes error responses from the API
func (c *OpenAIClient) handleErrorResponse(resp *http.Response) error {
	bodyBytes, readErr := io.ReadAll(resp.Body)
	errorMsg := fmt.Sprintf("LLM API returned status %d", resp.StatusCode)
	if readErr == nil && len(bodyBytes) > 0 {
		errorMsg = fmt.Sprintf("%s: %s", errorMsg, string(bodyBytes))
	}
	return fmt.Errorf(errorMsg)
}

// handleStreamingResponse processes streaming responses
func (c *OpenAIClient) handleStreamingResponse(resp *http.Response, out io.Writer) (string, int, error) {
	var completionBuilder strings.Builder
	reader := bufio.NewReader(resp.Body)
	var currentEventData strings.Builder

	for {
		line, readErr := reader.ReadString('\n')

		if readErr != nil && readErr != io.EOF {
			return "", 0, fmt.Errorf("reading streaming response line: %w", readErr)
		}

		line = strings.TrimRight(line, "\r\n")

		if strings.HasPrefix(line, "data: ") {
			currentEventData.WriteString(line[6:]) // Skip "data: "
		} else if line == "" {
			// Empty line signifies the end of an event
			eventData := currentEventData.String()
			currentEventData.Reset()

			if eventData == "[DONE]" {
				break // End of stream
			}

			// Process the event data
			content := c.processEventData(eventData, out)
			if content != "" {
				completionBuilder.WriteString(content)
			}
		}

		if readErr == io.EOF {
			break
		}
	}

	completionText := completionBuilder.String()
	completionTokens := c.getTokenLength(completionText)
	fmt.Printf("Streaming completion tokens (estimated from parsed content): %d\n", completionTokens)

	return completionText, completionTokens, nil
}

// processEventData extracts content from a streaming event
func (c *OpenAIClient) processEventData(eventData string, out io.Writer) string {
	// Parse the JSON data
	var chunk map[string]interface{}
	if jsonErr := json.Unmarshal([]byte(eventData), &chunk); jsonErr != nil {
		log.Printf("Warning: Failed to parse stream chunk JSON: %v, data: %s", jsonErr, eventData)
		return ""
	}

	// Extract content delta
	if choices, ok := chunk["choices"].([]interface{}); ok && len(choices) > 0 {
		if choice, ok := choices[0].(map[string]interface{}); ok {
			if delta, ok := choice["delta"].(map[string]interface{}); ok {
				if content, ok := delta["content"].(string); ok && content != "" {
					// Write to output and return for accumulation
					if _, writeErr := out.Write([]byte(content)); writeErr != nil {
						log.Printf("Error writing content delta to output: %v", writeErr)
					}
					return content
				}
			}
		}
	}

	return ""
}

// handleNonStreamingResponse processes non-streaming responses
func (c *OpenAIClient) handleNonStreamingResponse(resp *http.Response, out io.Writer) (string, int, error) {
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
			return "", 0, fmt.Errorf("reading non-streaming response body: %w", err)
		}
	}
	respBody := buffer.Bytes()

	fmt.Fprintln(out, "Finished reading response body.")
	fmt.Fprintln(out, "Raw Response Body:")
	fmt.Fprintln(out, string(respBody))

	// Try to parse the response
	var parsed struct {
		Choices []struct {
			Message Message `json:"message"`
		} `json:"choices"`
	}

	fmt.Printf("Response Body: %s\n", string(respBody))
	completionText := ""
	completionTokens := 0

	if err := json.Unmarshal(respBody, &parsed); err == nil && len(parsed.Choices) > 0 {
		completionText = parsed.Choices[0].Message.Content
		completionTokens = c.getTokenLength(completionText)

		fmt.Fprintln(out, "Parsed Response Content:")
		fmt.Fprintln(out, completionText)
		fmt.Printf("Non-streaming completion tokens: %d\n", completionTokens)
	} else {
		fmt.Fprintln(out, "Failed to parse response body.")
		completionText = string(respBody)
		completionTokens = c.getTokenLength(completionText)
		fmt.Printf("Non-streaming completion tokens (unparsed body): %d\n", completionTokens)
	}

	return completionText, completionTokens, nil
}
