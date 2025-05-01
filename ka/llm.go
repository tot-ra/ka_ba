package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"os"
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
	APIURL        string
	Model         string
	SystemMessage string
	APIKey        string // Added API Key field
}

// Updated NewLLMClient to accept apiKey
func NewLLMClient(apiURL, model, systemMessage, apiKey string) *LLMClient {
	return &LLMClient{
		APIURL:        apiURL,
		Model:         model,
		SystemMessage: systemMessage,
		APIKey:        apiKey, // Store API Key
	}
}

func (c *LLMClient) Chat(userPrompt string, stream bool, out io.Writer) error {
	messages := []Message{
		{Role: "system", Content: c.SystemMessage},
		{Role: "user", Content: userPrompt},
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
		return fmt.Errorf("failed to marshal request: %w", err)
	}

	req, err := http.NewRequest("POST", c.APIURL, bytes.NewBuffer(payload))
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	// Add Authorization header if APIKey is provided
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := ioutil.ReadAll(resp.Body)
		return fmt.Errorf("LLM API request failed with status %d: %s", resp.StatusCode, string(bodyBytes))
	}

	if stream {
		decoder := json.NewDecoder(resp.Body)
		for {
			var chunk map[string]interface{}
			if err := decoder.Decode(&chunk); err == io.EOF {
				break
			} else if err != nil {
				fmt.Fprintf(os.Stderr, "Error decoding stream chunk: %v\n", err)
				continue
			}

			if choices, ok := chunk["choices"].([]interface{}); ok && len(choices) > 0 {
				if choice, ok := choices[0].(map[string]interface{}); ok {
					if delta, ok := choice["delta"].(map[string]interface{}); ok {
						if content, ok := delta["content"].(string); ok {
							_, writeErr := fmt.Fprint(out, content)
							if writeErr != nil {
								return fmt.Errorf("failed to write stream output: %w", writeErr)
							}
						}
					}
				}
			}
		}
		fmt.Fprintln(out)
	} else {
		respBody, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			return fmt.Errorf("failed to read response body: %w", err)
		}

		var parsed struct {
			Choices []struct {
				Message Message `json:"message"`
			} `json:"choices"`
			Error map[string]interface{} `json:"error,omitempty"`
		}

		if err := json.Unmarshal(respBody, &parsed); err == nil {
			if parsed.Error != nil {
				return fmt.Errorf("LLM API returned an error: %v", parsed.Error)
			}
			if len(parsed.Choices) > 0 {
				_, writeErr := fmt.Fprintln(out, parsed.Choices[0].Message.Content)
				if writeErr != nil {
					return fmt.Errorf("failed to write response output: %w", writeErr)
				}
			} else {
				fmt.Fprintf(os.Stderr, "Warning: LLM response parsed but no choices found. Body: %s\n", string(respBody))
			}
		} else {
			fmt.Fprintf(os.Stderr, "Warning: Failed to parse LLM response JSON: %v. Writing raw body.\n", err)
			_, writeErr := fmt.Fprintln(out, string(respBody))
			if writeErr != nil {
				return fmt.Errorf("failed to write raw response output: %w", writeErr)
			}
		}
	}
	return nil
}
