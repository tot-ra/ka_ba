package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	// Added for string builder
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
	tokenizer        *tiktoken.Tiktoken
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
		APIURL:           apiURL,
		Model:            model,
		SystemMessage:    systemMessage, // Store the system message
		MaxContextLength: maxContextLength,
		tokenizer:        tkm,
	}
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

		// Truncate from the end of non-system messages
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
		reader := io.Reader(resp.Body)
		buffer := bytes.Buffer{}
		// We will read from 'reader', write to 'out', and write to 'completionBuilder'

		buf := make([]byte, 1024)
		for {
			// Read directly from the original response body reader
			n, readErr := reader.Read(buf)
			if n > 0 {
				// Write chunk to the output writer
				if _, writeErr := out.Write(buf[:n]); writeErr != nil {
					// Handle error writing to output if necessary, maybe just log
					fmt.Printf("Error writing stream chunk to output: %v\n", writeErr)
				}
				// Write chunk to our internal buffer for JSON decoding
				buffer.Write(buf[:n])
				// Write chunk to the string builder to capture the full response
				completionBuilder.Write(buf[:n])

				// Process JSON chunks from the internal buffer
				decoder := json.NewDecoder(&buffer) // Recreate decoder each time with current buffer state
				for buffer.Len() > 0 {
					var chunk map[string]interface{}
					if decodeErr := decoder.Decode(&chunk); decodeErr != nil {
						if decodeErr == io.EOF || decodeErr == io.ErrUnexpectedEOF {
							// Incomplete chunk, need more data
							break
						}
						// Handle other decoding errors if necessary
						// fmt.Printf("Streaming decoding error: %v\n", decodeErr) // Optional debug
						break // Assume incomplete chunk on error
					}
					// We don't strictly need to parse the content here again
					// as we are writing raw bytes to 'out' and 'completionBuilder'.
					// This loop is mainly to consume the decoded JSON object from the buffer.
				}
			}
			if readErr != nil {
				if readErr == io.EOF {
					break // End of stream
				}
				return "", finalInputTokens, 0, fmt.Errorf("reading streaming response body: %w", readErr)
			}
		}
		fmt.Fprintln(out) // Add a newline at the end of the stream

		completionText := completionBuilder.String()
		// Now, attempt to parse the *complete* streamed text to extract the actual content
		// This is tricky because the raw stream might contain multiple JSON objects.
		// A simpler approach for token counting is to tokenize the raw captured text.
		// This might overestimate tokens if there's non-content JSON structure, but it's better than 0.
		completionTokens := c.getTokenLength(completionText)
		fmt.Printf("Streaming completion tokens (estimated from raw stream): %d\n", completionTokens)

		// We should return the *parsed* content if possible, but the current structure
		// just writes to 'out'. Returning the raw captured text is the best we can do
		// without significantly refactoring the streaming logic.
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
