package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/ioutil"
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
	APIURL        string
	Model         string
	SystemMessage string
}

func NewLLMClient(apiURL, model, systemMessage string) *LLMClient {
	return &LLMClient{APIURL: apiURL, Model: model, SystemMessage: systemMessage}
}


func (c *LLMClient) Chat(ctx context.Context, userPrompt string, stream bool, out io.Writer) error {
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
		return err
	}

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

	if resp.StatusCode != 200 {
		return fmt.Errorf("LLM API returned status %d", resp.StatusCode)
	}

	if stream {

		decoder := json.NewDecoder(resp.Body)
		for decoder.More() {
			var chunk map[string]interface{}
			if err := decoder.Decode(&chunk); err != nil {
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
		fmt.Fprintln(out)
	} else {
		respBody, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			return err
		}
		var parsed struct {
			Choices []struct {
				Message Message `json:"message"`
			} `json:"choices"`
		}
		if err := json.Unmarshal(respBody, &parsed); err == nil && len(parsed.Choices) > 0 {
			fmt.Fprintln(out, parsed.Choices[0].Message.Content)
		} else {
			fmt.Fprintln(out, string(respBody))
		}
	}
	return nil
}
