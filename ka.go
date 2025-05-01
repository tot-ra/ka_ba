package main

import (
	"ka/a2a"
	"ka/llm"
	"context" // Import the context package
	"encoding/json"
	"flag"
	"fmt"
	"io/ioutil"
	"os"
)

const (
	model                   = "qwen3-30b-a3b"
	systemMessage           = "Think step by step and provide clear instructions to the user."
	apiURL                  = "http://localhost:1234/v1/chat/completions"
	defaultMaxContextLength = 2048
)

func main() {
	serveFlag := flag.Bool("serve", false, "Run the agent as an A2A HTTP server")
	streamFlag := flag.Bool("stream", false, "Enable streaming output for CLI chat")
	describeFlag := flag.Bool("describe", false, "Output the agent's self-description (agent.json) and exit")
	maxContextLengthFlag := flag.Int("max_context_length", defaultMaxContextLength, "Maximum context length for the LLM")
	modelFlag := flag.String("model", model, "LLM model to use")

	flag.Parse()

	// Check for "server" as a non-flag argument
	args := flag.Args()
	if len(args) > 0 && args[0] == "server" {
		*serveFlag = true
		// Remove "server" from args so it's not treated as a prompt in CLI mode
		flag.Set("args", "") // Clear args to prevent it being used as prompt
	}

	if *describeFlag {
		agentCardJSON, err := json.MarshalIndent(agentCard, "", "  ")
		if err != nil {
			fmt.Fprintln(os.Stderr, "Error marshalling agent description:", err)
			os.Exit(1)
		}
		fmt.Println(string(agentCardJSON))
		os.Exit(0)
	}

	// Pass apiKey to the client constructor
	llmClient := llm.NewLLMClient(apiURL, *modelFlag, systemMessage, *maxContextLengthFlag) // Removed apiKey argument

	if *serveFlag {
		fmt.Println("[main] Starting in server mode...")
		taskStore, err := a2a.NewFileTaskStore("")
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error initializing file task store: %v\n", err)
			os.Exit(1)
		}
		startHTTPServer(llmClient, taskStore)
	} else {
		fmt.Println("[main] Starting in CLI chat mode...")
		stream := *streamFlag
		if os.Getenv("LLM_STREAM") == "true" {
			stream = true
		}

		var userPrompt string
		args := flag.Args()
		if len(args) > 0 {
			userPrompt = args[0]
		} else if !isTerminal(os.Stdin) {
			inputBytes, err := ioutil.ReadAll(os.Stdin)
			if err != nil {
				fmt.Fprintln(os.Stderr, "Error reading from stdin:", err)
				os.Exit(1)
			}
			userPrompt = string(inputBytes)
		}

		if userPrompt == "" {
			fmt.Fprintln(os.Stderr, "Error: No prompt provided via arguments or stdin.")
			fmt.Fprintln(os.Stderr, "Usage: ka [options] \"Your prompt here\"")
			fmt.Fprintln(os.Stderr, "   or: echo \"Your prompt here\" | ka [options]")
			fmt.Fprintln(os.Stderr, "Options:")
			flag.PrintDefaults()
			os.Exit(1)
		}

		// Added context.Background() as the first argument
		if err := llmClient.Chat(context.Background(), userPrompt, stream, os.Stdout); err != nil {
			fmt.Fprintln(os.Stderr, "LLM error:", err)
			os.Exit(1)
		}
	}
}

func isTerminal(f *os.File) bool {
	fileInfo, err := f.Stat()
	if err != nil {
		return false
	}
	return (fileInfo.Mode() & os.ModeCharDevice) != 0
}
