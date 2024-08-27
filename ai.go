package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"os"
)

const (
	model         = "lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"
	systemMessage = "Think step by step and provide clear instructions to the user."
	apiURL        = "http://localhost:1234/v1/chat/completions"
	contentType   = "application/json"
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

func main() {
	var prompt string
	var cliInput string

	// Check if a prompt is provided as a parameter or from STDIN
	if len(os.Args) > 1 {
		prompt = os.Args[1]
	}

	// Read from STDIN if connected
	if !isTerminal() {
		input, err := ioutil.ReadAll(os.Stdin)
		if err != nil {
			fmt.Println("Error reading from STDIN:", err)
			os.Exit(1)
		}
		cliInput = string(input)
	}

	// Create JSON for the system message and user input
	systemMessageJSON := Message{Role: "system", Content: systemMessage}
	//fmt.Println("System JSON:", toJSON(systemMessageJSON))

	var userInput Message
	if cliInput != "" {
		userInput = Message{Role: "user", Content: cliInput}
	} else if prompt != "" {
		userInput = Message{Role: "user", Content: prompt}
	} else {
		fmt.Println("Error: Please provide a prompt or input from STDIN")
		os.Exit(1)
	}
	//fmt.Println("User Input JSON:", toJSON(userInput))

	// Create the request payload
	request := Request{
		Model:       model,
		Messages:    []Message{systemMessageJSON, userInput},
		Temperature: 0.7,
		MaxTokens:   -1,
		Stream:      false,
	}

	// Marshal the request payload to JSON
	payload, err := json.Marshal(request)
	if err != nil {
		fmt.Println("Error marshaling JSON:", err)
		os.Exit(1)
	}

	// Create the HTTP request
	req, err := http.NewRequest("POST", apiURL, bytes.NewBuffer(payload))
	if err != nil {
		fmt.Println("Error creating HTTP request:", err)
		os.Exit(1)
	}
	req.Header.Set("Content-Type", contentType)

	// Execute the HTTP request
	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		fmt.Println("Error executing HTTP request:", err)
		os.Exit(1)
	}
	defer resp.Body.Close()

	// Read the response
	responseBody, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		fmt.Println("Error reading HTTP response:", err)
		os.Exit(1)
	}

	//fmt.Println("Raw response:", string(responseBody))

	// Uncomment the lines below if needed to parse the response JSON
	var jsonResponse map[string]interface{}
	if err := json.Unmarshal(responseBody, &jsonResponse); err != nil {
		fmt.Println("Error parsing JSON response:", err)
		os.Exit(1)
	}
	content := jsonResponse["choices"].([]interface{})[0].(map[string]interface{})["message"].(map[string]interface{})["content"].(string)
	fmt.Println(content)
}

func toJSON(v interface{}) string {
	b, err := json.Marshal(v)
	if err != nil {
		return ""
	}
	return string(b)
}

func isTerminal() bool {
	// Check if the process is connected to a terminal
	fileInfo, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return fileInfo.Mode()&os.ModeCharDevice != 0
}
