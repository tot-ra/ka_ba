package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
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
	SystemMessage    string
	MaxContextLength int
}

func NewLLMClient(apiURL, model, systemMessage string, maxContextLength int) *LLMClient {
	return &LLMClient{APIURL: apiURL, Model: model, SystemMessage: systemMessage, MaxContextLength: maxContextLength}
}

func getTokenLength(text string) int {
	return len(text) / 4
}

func (c *LLMClient) Chat(ctx context.Context, userPrompt string, stream bool, out io.Writer) error {
	messages := []Message{
		{Role: "system", Content: c.SystemMessage},
		{Role: "user", Content: userPrompt},
	}

	totalTokenLength := 0
	for _, message := range messages {
		totalTokenLength += getTokenLength(message.Content)
	}
	fmt.Printf("Current context length: %d tokens\n", totalTokenLength)

	if c.MaxContextLength > 0 && totalTokenLength > c.MaxContextLength {
		fmt.Printf("Context length exceeds maximum allowed length of %d tokens. Truncating messages.\n", c.MaxContextLength)
		// Truncate messages to fit within the context length
		for totalTokenLength > c.MaxContextLength && len(messages) > 0 {
			// Remove the oldest message
			totalTokenLength -= getTokenLength(messages[0].Content)
			messages = messages[1:]
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
		return err
	}

	// Log the request payload
	fmt.Printf("Sending request to %s with payload: %s\n", c.APIURL, string(payload))

	req, err := http.NewRequestWithContext(ctx, "POST", c.APIURL, bytes.NewBuffer(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	fmt.Fprintln(out, "Received response header.") // Added log

	// Log the response status code
	fmt.Printf("Received response with status code: %d\n", resp.StatusCode)

	if resp.StatusCode != 200 {
		return fmt.Errorf("LLM API returned status %d", resp.StatusCode)
	}

	if stream {
		reader := io.Reader(resp.Body)
		buffer := bytes.Buffer{}
		decoder := json.NewDecoder(&buffer)

		buf := make([]byte, 1024)
		for {
			n, err := reader.Read(buf)
			if n > 0 {
				buffer.Write(buf[:n])
				for buffer.Len() > 0 {
					var chunk map[string]interface{}
					if err := decoder.Decode(&chunk); err != nil {
						// If decoding fails, it might be an incomplete chunk,
						// break the inner loop and read more data.
						// If it's not io.EOF, print the error for debugging.
						if err != io.EOF {
							// fmt.Printf("Decoding error: %v\n", err) // Optional: for debugging
						}
						break
					}
					if choices, ok := chunk["choices"].([]interface{}); ok {
						for _, c := range choices {
							if choice, ok := c.(map[string]interface{}); ok {
								if delta, ok := choice["delta"].(map[string]interface{}); ok {
									if content, ok := delta["content"].(string); ok {
										fmt.Fprint(out, content)
									}
								}
							}
						}
					}
				}
			}
			if err != nil {
				if err == io.EOF {
					break // End of stream
				}
				return fmt.Errorf("reading response body: %w", err)
			}
		}
		fmt.Fprintln(out) // Add a newline at the end of the stream
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
				return fmt.Errorf("reading response body: %w", err)
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
		if err := json.Unmarshal(respBody, &parsed); err == nil && len(parsed.Choices) > 0 {
			// If unmarshalling succeeds, also print the parsed content (this will appear after the raw body)
			fmt.Fprintln(out, "Parsed Response Content:") // Added label
			fmt.Fprintln(out, parsed.Choices[0].Message.Content)
		} else {
			// If unmarshalling fails, the raw body is already printed, so no need to print again here.
			// fmt.Fprintln(out, string(respBody)) // Removed duplicate print
			fmt.Fprintln(out, "Failed to parse response body.") // Added log
		}
	}
	return nil
}
