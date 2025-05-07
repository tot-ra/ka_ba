package main

import (
	"context" // Import the context package
	"flag"
	"fmt"
	"io/ioutil"
	"ka/a2a"
	"ka/llm"
	"ka/tools" // Import the tools package
	"log" // Manually added back
	"os"
	"strconv" // Added for port conversion
	"strings" // Added for API key splitting
)

const (
	model                   = "qwen3-30b-a3b"
	apiURL                  = "http://localhost:1234/v1/chat/completions"
	defaultMaxContextLength = 2048
)

var availableToolsMap map[string]tools.Tool

func main() {
	serveFlag := flag.Bool("serve", false, "Run the agent as an A2A HTTP server")
	streamFlag := flag.Bool("stream", false, "Enable streaming output for CLI chat")
	// describeFlag removed as agent card is now dynamic
	maxContextLengthFlag := flag.Int("max_context_length", defaultMaxContextLength, "Maximum context length for the LLM")
	modelFlag := flag.String("model", model, "LLM model to use")
	portFlag := flag.Int("port", 8080, "Port for the A2A HTTP server")
	nameFlag := flag.String("name", "Default ka agent", "Name of the agent")
	descriptionFlag := flag.String("description", "A spawned ka agent instance.", "Description of the agent")
	jwtSecretFlag := flag.String("jwt-secret", "", "JWT secret key for securing endpoints (if provided, JWT auth is enabled)")
	apiKeysFlag := flag.String("api-keys", "", "Comma-separated list of valid API keys (if provided, API key auth is enabled)")
	// Removed systemPromptFlag as prompt is now composed dynamically

	// Redirect standard log output to stdout
	log.SetOutput(os.Stdout)

	flag.Parse()

	// Load all available tools
	availableToolsSlice := tools.GetAllTools()
	availableToolsMap := make(map[string]tools.Tool)
	for _, tool := range availableToolsSlice {
		availableToolsMap[tool.GetName()] = tool
	}

	// Determine the port
	port := *portFlag // Start with the flag value (or default)
	envPortStr := os.Getenv("PORT")
	if envPortStr != "" {
		envPort, err := strconv.Atoi(envPortStr)
		if err == nil {
			port = envPort // Use environment variable if valid
		} else {
			fmt.Fprintf(os.Stderr, "Warning: Invalid PORT environment variable '%s', using default/flag value: %d\n", envPortStr, port)
		}
	}

	// Check for "server" as a non-flag argument
	args := flag.Args()
	if len(args) > 0 && args[0] == "server" {
		*serveFlag = true
		// Remove "server" from args so it's not treated as a prompt in CLI mode
		flag.Set("args", "") // Clear args to prevent it being used as prompt
	}

	// Removed describeFlag logic

	// Get the current working directory
	currentDir, err := os.Getwd()
	if err != nil {
		log.Printf("[main] Error getting current working directory: %v", err)
		currentDir = "unknown" // Fallback
	}

	// In server mode, we will compose the system prompt dynamically based on task input.
	// In CLI mode, we will compose a default prompt with all available tools.

	if *serveFlag {
		fmt.Println("[main] Starting in server mode...")
		taskStoreDir := os.Getenv("TASK_STORE_DIR") // Read environment variable
		if taskStoreDir == "" {
			fmt.Println("[main] TASK_STORE_DIR not set, using default task directory.")
		} else {
			fmt.Printf("[main] Using task directory from TASK_STORE_DIR: %s\n", taskStoreDir)
		}
		taskStore, err := a2a.NewFileTaskStore(taskStoreDir) // Pass the determined directory
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error initializing file task store: %v\n", err)
			os.Exit(1)
		}

		// Create the LLM client for server mode (system message is handled per task)
		llmClient := llm.NewLLMClient(apiURL, *modelFlag, "", *maxContextLengthFlag)

		// Create TaskExecutor with the LLM client, task store, and available tools
		// The system message will be passed per task
		taskExecutor := a2a.NewTaskExecutor(llmClient, taskStore, availableToolsMap) // Pass availableToolsMap
		fmt.Printf("[main] TaskExecutor initialized with %d available tools.\n", len(availableToolsMap))

		// Process API keys from flag
		apiKeys := []string{}
		if *apiKeysFlag != "" {
			keys := strings.Split(*apiKeysFlag, ",")
			for _, key := range keys {
				trimmedKey := strings.TrimSpace(key)
				if trimmedKey != "" {
					apiKeys = append(apiKeys, trimmedKey)
				}
			}
		}

		// Pass the TaskExecutor, port, agent info, and auth config to the server start function
		startHTTPServer(
			taskExecutor, 
			llmClient,
			port, 
			*nameFlag, 
			*descriptionFlag, 
			*modelFlag, 
			*jwtSecretFlag, 
			apiKeys, 
			availableToolsMap,
		)

	} else {
		// Ensure auth flags are not accidentally used in CLI mode (or warn)
		if *jwtSecretFlag != "" || *apiKeysFlag != "" {
			fmt.Fprintln(os.Stderr, "Warning: --jwt-secret and --api-keys flags are only used in server mode (--serve or 'server' argument).")
		}
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

		// For CLI mode, compose a default system prompt with all available tools
		var allToolNames []string
		for name := range availableToolsMap {
			allToolNames = append(allToolNames, name)
		}
		cliSystemMessage := tools.ComposeSystemPrompt(allToolNames, availableToolsMap, currentDir)
		fmt.Printf("[main] Using CLI system message:\n%s\n", cliSystemMessage)

		// Pass the CLI system message to the LLM client for CLI mode
		cliLLMClient := llm.NewLLMClient(apiURL, *modelFlag, cliSystemMessage, *maxContextLengthFlag)


		// For CLI mode, create a simple message slice with the user prompt, including the actual system message
		messages := []llm.Message{
			{Role: "system", Content: cliSystemMessage}, // Include the actual system message
			{Role: "user", Content: userPrompt},
		}

		// In CLI mode, we don't have the full tool execution loop.
		// We'll just send the initial prompt and print the LLM's response.
		// A more complete CLI tool execution would require implementing the loop here.
		fmt.Println("[main] Sending prompt to LLM...")
		completion, inputTokens, completionTokens, err := cliLLMClient.Chat(context.Background(), messages, stream, os.Stdout)
		if err != nil {
			fmt.Fprintln(os.Stderr, "LLM error:", err)
			os.Exit(1)
		}
		// Optionally log token usage in CLI mode
		fmt.Fprintf(os.Stderr, "\n[CLI Mode] Input Tokens: %d, Completion Tokens: %d\n", inputTokens, completionTokens)
		// Print the final completion if not streaming (streaming is handled by llmClient.Chat)
		if !stream && completion != "" {
			fmt.Println(completion)
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
