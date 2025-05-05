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

type LLMClient struct {
	APIURL           string
	Model            string
	SystemMessage    string // Added SystemMessage field
	MaxContextLength int
	tokenizer *tiktoken.Tiktoken
}

func NewLLMClient(apiURL, model, systemMessage string, maxContextLength int) *LLMClient { // Added systemMessage parameter
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
	return &LLMClient{
		APIURL: apiURL,
		Model: model,
		SystemMessage: systemMessage, // Store the system message
		MaxContextLength: maxContextLength,
		tokenizer: tkm,
	}
}

// UpdateSystemMessage updates the system message for the LLM client.
func (c *LLMClient) UpdateSystemMessage(newSystemMessage string) {
	c.SystemMessage = newSystemMessage
	fmt.Printf("LLMClient system message updated to: %s\n", newSystemMessage)
}

// getTokenLength uses the client's specific tiktoken tokenizer to count tokens.
func (c *LLMClient) getTokenLength(text string) int {
	if c.tokenizer == nil {
		// Should not happen due to logic in NewLLMClient, but good practice.
		fmt.Println("Error: Tokenizer not initialized for LLMClient.")
		// Returning a high number might be safer than 0 if this somehow occurs,
		// to prevent accidentally exceeding context limits.
		return len(text) // Fallback to character count as a rough upper bound.
	}
	tokens := c.tokenizer.Encode(text, nil, nil)
	return len(tokens)
}

// Chat sends the provided messages to the LLM and returns the completion, input tokens, completion tokens, and error.
func (c *LLMClient) Chat(ctx context.Context, messages []Message, stream bool, out io.Writer) (string, int, int, error) {
	// Prepend the system message
	systemMessage := Message{
		Role:    "system",
		Content: c.SystemMessage,
	}
	// Create a new slice with the system message first, followed by the original messages
	messagesWithSystem := append([]Message{systemMessage}, messages...)

	inputTokenLength := 0
	for _, message := range messagesWithSystem { // Iterate over the new slice
		inputTokenLength += c.getTokenLength(message.Content)
	}
	fmt.Printf("Current context length: %d tokens\n", inputTokenLength)

	// Store the final calculated input tokens before potential truncation for accurate reporting
	finalInputTokens := inputTokenLength

	// Now use messagesWithSystem for the rest of the function
	messages = messagesWithSystem // Reassign messages to the new slice

	if c.MaxContextLength > 0 && inputTokenLength > c.MaxContextLength { // Use inputTokenLength
		fmt.Printf("Context length exceeds maximum allowed length of %d tokens. Truncating messages.\n", c.MaxContextLength)
		// Truncate messages to fit within the context length
		// Prioritize keeping system messages if they exist
		// Note: The system message is already prepended, so we just need to ensure it's not truncated unless absolutely necessary.
		// The truncation logic below already handles this by prioritizing messages at the beginning of the slice (which now includes the system message).

		// We need to find the index of the last system message to avoid truncating them prematurely.
		lastSystemIndex := -1
		for i, msg := range messages {
			if msg.Role == "system" {
				lastSystemIndex = i
			}
		}

		// Truncate from the end, but stop before the last system message if possible
		for inputTokenLength > c.MaxContextLength && len(messages) > lastSystemIndex+1 { // Ensure we don't remove the last system message
			removedMsg := messages[len(messages)-1]
			messages = messages[:len(messages)-1]
			inputTokenLength -= c.getTokenLength(removedMsg.Content)
			fmt.Printf("Truncated message. New context length: %d tokens\n", inputTokenLength)
		}

		// If still too long, truncate system messages (should be rare)
		for inputTokenLength > c.MaxContextLength && len(messages) > 0 {
			removedMsg := messages[0]
			messages = messages[1:]
			inputTokenLength -= c.getTokenLength(removedMsg.Content)
			fmt.Printf("Truncated system message. New context length: %d tokens\n", inputTokenLength)
		}
	}

	request := Request{
		Model:       c.Model,
		Messages:    messages,
		Temperature: 0.7,
		MaxTokens:   -1,
		Stream:      stream,
	}
	payload, err := json.Marshal(request)
	if err != nil {
		return "", finalInputTokens, 0, err
	}

	// Log the request payload
	fmt.Printf("Sending request to %s with payload: %s\n", c.APIURL, string(payload))

	req, err := http.NewRequestWithContext(ctx, "POST", c.APIURL, bytes.NewBuffer(payload))
	if err != nil {
		return "", finalInputTokens, 0, err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return "", finalInputTokens, 0, err
	}
	defer resp.Body.Close()

	fmt.Fprintln(out, "Received response header.") // Added log

	// Log the response status code
	fmt.Printf("Received response with status code: %d\n", resp.StatusCode)

	if resp.StatusCode != 200 {
		// Read the body even on error for potential details
		bodyBytes, readErr := io.ReadAll(resp.Body)
		errorMsg := fmt.Sprintf("LLM API returned status %d", resp.StatusCode)
		if readErr == nil && len(bodyBytes) > 0 {
			errorMsg = fmt.Sprintf("%s: %s", errorMsg, string(bodyBytes))
		}
		return "", finalInputTokens, 0, fmt.Errorf(errorMsg)
	}

	if stream {
		var completionBuilder strings.Builder // Use strings.Builder to capture completion
		reader := bufio.NewReader(resp.Body) // Use bufio.Reader for easier line reading
		var currentEventData strings.Builder // Buffer for accumulating data lines for a single SSE event

		for {
			line, readErr := reader.ReadString('\n')

			if readErr != nil && readErr != io.EOF {
				return "", finalInputTokens, 0, fmt.Errorf("reading streaming response line: %w", readErr)
			}

			line = strings.TrimRight(line, "\r\n") // Trim potential \r and \n

			if strings.HasPrefix(line, "data: ") {
				// Append data line content (after "data: ") to the current event data buffer
				currentEventData.WriteString(line[6:]) // +6 to skip "data: "
			} else if line == "" {
				// Empty line signifies the end of an event
				eventData := currentEventData.String()
				currentEventData.Reset() // Reset buffer for the next event

				if eventData == "[DONE]" {
					break // End of stream signal
				}

				// Parse the JSON data for this event
				var chunk map[string]interface{}
				if jsonErr := json.Unmarshal([]byte(eventData), &chunk); jsonErr != nil {
					log.Printf("Warning: Failed to parse stream chunk JSON: %v, data: %s", jsonErr, eventData)
					// Continue processing, maybe this chunk was just metadata or an error we can skip
					continue
				}

				// Extract the content delta
				// Navigate the nested structure: choices -> [0] -> delta -> content
				if choices, ok := chunk["choices"].([]interface{}); ok && len(choices) > 0 {
					if choice, ok := choices[0].(map[string]interface{}); ok {
						if delta, ok := choice["delta"].(map[string]interface{}); ok {
							if content, ok := delta["content"].(string); ok && content != "" {
								// Found content delta, write it to the output writer
								// This will call SSEWriter.Write, which wraps it in {"chunk": "..."}
								if _, writeErr := out.Write([]byte(content)); writeErr != nil {
									log.Printf("Error writing content delta to output: %v", writeErr)
									// Depending on error handling strategy, might return here
								}
								// Also append to the completion builder for the full result
								completionBuilder.WriteString(content)
							}
							// Handle tool_calls delta if needed in the future
							// if toolCalls, ok := delta["tool_calls"].([]interface{}); ok { ... }
						}
					}
				}

			} else if strings.HasPrefix(line, ":") {
				// Ignore comment lines (keep-alives)
				continue
			} else {
				// Handle other unexpected lines if necessary
				log.Printf("Warning: Unexpected line in stream: %s", line)
			}

			if readErr == io.EOF {
				break // End of stream
			}
		}

		// After the loop, calculate completion tokens and return
		completionText := completionBuilder.String()
		completionTokens := c.getTokenLength(completionText)
		fmt.Printf("Streaming completion tokens (estimated from parsed content): %d\n", completionTokens)

		return completionText, finalInputTokens, completionTokens, nil

	} else {
		// Read the entire response body into a buffer
		fmt.Fprintln(out, "Attempting to read response body...") // Added log
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
					break // End of stream
				}
				return "", finalInputTokens, 0, fmt.Errorf("reading non-streaming response body: %w", err)
			}
		}
		respBody := buffer.Bytes()
		fmt.Fprintln(out, "Finished reading response body.") // Added log

		// Always print the raw response body to stdout for debugging
		fmt.Fprintln(out, "Raw Response Body:") // Added label
		fmt.Fprintln(out, string(respBody))

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
			// If unmarshalling succeeds, also print the parsed content (this will appear after the raw body)
			fmt.Fprintln(out, "Parsed Response Content:") // Added label
			fmt.Fprintln(out, completionText)
			fmt.Printf("Non-streaming completion tokens: %d\n", completionTokens) // Log tokens
			return completionText, finalInputTokens, completionTokens, nil
		} else {
			// If unmarshalling fails, the raw body is already printed.
			fmt.Fprintln(out, "Failed to parse response body.") // Added log
			// Even if parsing fails, return the raw body and 0 completion tokens
			// Use respBody as completionText in this error case.
			completionText = string(respBody)
			// We can still try to tokenize the raw body, might be useful sometimes.
			completionTokens = c.getTokenLength(completionText)
			fmt.Printf("Non-streaming completion tokens (unparsed body): %d\n", completionTokens) // Log tokens
			return completionText, finalInputTokens, completionTokens, nil                        // Return raw body, 0 tokens, no error (as API call succeeded)
		}
	}
	// This path should ideally not be reached if stream/non-stream logic is exhaustive.
	// return "", finalInputTokens, 0, fmt.Errorf("unexpected end of Chat function") // Removed unreachable code
}
