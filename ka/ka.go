package main

import (
	"context" // Import the context package
	"flag"
	"fmt"
	"io/ioutil"
	"ka/a2a"
	"ka/llm"
	"ka/tools" // Import the tools package
	"log"      // Manually added back
	"os"
	// "os/user" // No longer needed here
	// "runtime" // No longer needed here
	"strconv" // Added for port conversion
	"strings" // Added for API key splitting
	// "time"    // No longer needed here
)

const (
	model                   = "qwen3-30b-a3b"
	apiURL                  = "http://localhost:1234/v1/chat/completions"
	defaultMaxContextLength = 2048
)

var availableToolsMap map[string]tools.Tool

func main() {
	// Parse command line flags
	flags := parseFlags()

	// Load available tools and get the McpTool instance
	availableToolsMap, mcpToolInstance := loadTools()

	// Determine port from flags and environment
	port := determinePort(flags.portFlag)

	// Check for "server" as a non-flag argument
	checkServerArg(&flags.serveFlag)

	// Get current working directory
	currentDir := getCurrentWorkingDirectory()

	if flags.serveFlag {
		runServerMode(flags, port, availableToolsMap, mcpToolInstance, currentDir) // Pass mcpToolInstance
	} else {
		runCLIMode(flags, availableToolsMap) // currentDir no longer passed
	}
}

// FlagOptions holds all command line flags
type FlagOptions struct {
	serveFlag            bool
	streamFlag           bool
	maxContextLengthFlag int
	modelFlag            string
	portFlag             int
	nameFlag             string
	descriptionFlag      string
	jwtSecretFlag        string
	apiKeysFlag          string
	mcpConfigFlag string // Add flag for MCP server configuration
	providerFlag  string // Add flag for LLM provider type
}

func parseFlags() FlagOptions {
	var flags FlagOptions

	flag.BoolVar(&flags.serveFlag, "serve", false, "Run the agent as an A2A HTTP server")
	flag.BoolVar(&flags.streamFlag, "stream", false, "Enable streaming output for CLI chat")
	flag.IntVar(&flags.maxContextLengthFlag, "max_context_length", defaultMaxContextLength, "Maximum context length for the LLM")
	flag.StringVar(&flags.modelFlag, "model", model, "LLM model to use")
	flag.IntVar(&flags.portFlag, "port", 8080, "Port for the A2A HTTP server")
	flag.StringVar(&flags.nameFlag, "name", "Default ka agent", "Name of the agent")
	flag.StringVar(&flags.descriptionFlag, "description", "A spawned ka agent instance.", "Description of the agent")
	flag.StringVar(&flags.jwtSecretFlag, "jwt-secret", "", "JWT secret key for securing endpoints (if provided, JWT auth is enabled)")
	flag.StringVar(&flags.apiKeysFlag, "api-keys", "", "Comma-separated list of valid API keys (if provided, API key auth is enabled)")
	flag.StringVar(&flags.mcpConfigFlag, "mcp-config", "", "Path to MCP server configuration file or JSON string") // Define the new flag
	flag.StringVar(&flags.providerFlag, "provider", "lmstudio", "LLM provider to use (e.g., 'lmstudio', 'google')") // Define the new provider flag

	// Redirect standard log output to stdout
	log.SetOutput(os.Stdout)

	flag.Parse()
	return flags
}

// loadTools loads all available tools and returns the map and the McpTool instance.
func loadTools() (map[string]tools.Tool, *tools.McpTool) {
	availableToolsSlice := tools.GetAllTools()
	availableToolsMap := make(map[string]tools.Tool)
	var mcpToolInstance *tools.McpTool // Declare a variable to hold the McpTool instance

	for _, tool := range availableToolsSlice {
		availableToolsMap[tool.GetName()] = tool
		// Check if the tool is the McpTool and store its instance
		if mcpTool, ok := tool.(*tools.McpTool); ok {
			mcpToolInstance = mcpTool
		}
	}
	return availableToolsMap, mcpToolInstance
}

func determinePort(portFlag int) int {
	port := portFlag
	envPortStr := os.Getenv("PORT")
	if envPortStr != "" {
		envPort, err := strconv.Atoi(envPortStr)
		if err == nil {
			port = envPort
		} else {
			fmt.Fprintf(os.Stderr, "Warning: Invalid PORT environment variable '%s', using default/flag value: %d\n", envPortStr, port)
		}
	}
	return port
}

func checkServerArg(serveFlag *bool) {
	args := flag.Args()
	if len(args) > 0 && args[0] == "server" {
		*serveFlag = true
		flag.Set("args", "")
	}
}

func getCurrentWorkingDirectory() string {
	currentDir, err := os.Getwd()
	if err != nil {
		log.Printf("[main] Error getting current working directory: %v", err)
		currentDir = "unknown"
	}
	return currentDir
}

func runServerMode(flags FlagOptions, port int, availableToolsMap map[string]tools.Tool, mcpToolInstance *tools.McpTool, currentDir string) { // Add mcpToolInstance
	fmt.Println("[main] Starting in server mode...")

	// Initialize task store
	taskStore := initializeTaskStore()

	// Create LLM client for server mode using the factory
	llmConfig := llm.ClientConfig{
		"apiURL":           apiURL, // Default API URL for LM Studio
		"model":            flags.modelFlag,
		"systemMessage":    "", // Initial system message for server mode
		"maxContextLength": flags.maxContextLengthFlag,
		// Google API key is now only read from GEMINI_API_KEY env var in NewGoogleClient
	}
	llmClient, err := llm.NewClientFactory(flags.providerFlag, llmConfig)
	if err != nil {
		log.Fatalf("Failed to create LLM client for server mode: %v", err)
	}

	// Create TaskExecutor
	// The system prompt for the TaskExecutor should probably come from configuration or a default
	// For now, let's use an empty string as the initial system message for the server.
	// A separate endpoint exists to update the system prompt.
	serverSystemMessage := ""
	taskExecutor := a2a.NewTaskExecutor(llmClient, taskStore, availableToolsMap, serverSystemMessage)
	fmt.Printf("[main] TaskExecutor initialized with %d available tools.\n", len(availableToolsMap))

	// Process API keys
	apiKeys := processAPIKeys(flags.apiKeysFlag)

	// Start HTTP server
	startHTTPServer(
		taskExecutor,
		llmClient,
		port,
		flags.nameFlag,
		flags.descriptionFlag,
		flags.modelFlag,
		flags.jwtSecretFlag,
		apiKeys,
		availableToolsMap,
		mcpToolInstance, // Pass mcpToolInstance
	)
}

func initializeTaskStore() a2a.TaskStore {
	taskStoreDir := os.Getenv("TASK_STORE_DIR")
	if taskStoreDir == "" {
		fmt.Println("[main] TASK_STORE_DIR not set, using default task directory.")
	} else {
		fmt.Printf("[main] Using task directory from TASK_STORE_DIR: %s\n", taskStoreDir)
	}

	taskStore, err := a2a.NewFileTaskStore(taskStoreDir)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error initializing file task store: %v\n", err)
		os.Exit(1)
	}
	return taskStore
}

func processAPIKeys(apiKeysFlag string) []string {
	apiKeys := []string{}
	if apiKeysFlag != "" {
		keys := strings.Split(apiKeysFlag, ",")
		for _, key := range keys {
			trimmedKey := strings.TrimSpace(key)
			if trimmedKey != "" {
				apiKeys = append(apiKeys, trimmedKey)
			}
		}
	}
	return apiKeys
}

func runCLIMode(flags FlagOptions, availableToolsMap map[string]tools.Tool) {
	// Warn about auth flags in CLI mode
	warnAboutAuthFlags(flags.jwtSecretFlag, flags.apiKeysFlag)

	fmt.Println("[main] Starting in CLI chat mode...")

	// Determine if streaming should be enabled
	stream := determineStreamFlag(flags.streamFlag)

	// Get user prompt from args or stdin
	userPrompt := getUserPrompt()

	// Compose system prompt with all available tools
	cliSystemMessage := composeCliSystemMessage(availableToolsMap)

	// Create LLM client for CLI mode using the factory
	cliLLMConfig := llm.ClientConfig{
		"apiURL":           apiURL, // Default API URL for LM Studio
		"model":            flags.modelFlag,
		"systemMessage":    cliSystemMessage, // System message for CLI mode
		"maxContextLength": flags.maxContextLengthFlag,
		// Google API key is now only read from GEMINI_API_KEY env var in NewGoogleClient
	}
	cliLLMClient, err := llm.NewClientFactory(flags.providerFlag, cliLLMConfig)
	if err != nil {
		log.Fatalf("Failed to create LLM client for CLI mode: %v", err)
	}

	// Send prompt to LLM and handle response
	sendPromptToLLM(cliLLMClient, cliSystemMessage, userPrompt, stream)
}

func warnAboutAuthFlags(jwtSecretFlag, apiKeysFlag string) {
	if jwtSecretFlag != "" || apiKeysFlag != "" {
		fmt.Fprintln(os.Stderr, "Warning: --jwt-secret and --api-keys flags are only used in server mode (--serve or 'server' argument).")
	}
}

func determineStreamFlag(streamFlag bool) bool {
	stream := streamFlag
	if os.Getenv("LLM_STREAM") == "true" {
		stream = true
	}
	return stream
}

func getUserPrompt() string {
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
		printUsageAndExit()
	}

	return userPrompt
}

func printUsageAndExit() {
	fmt.Fprintln(os.Stderr, "Error: No prompt provided via arguments or stdin.")
	fmt.Fprintln(os.Stderr, "Usage: ka [options] \"Your prompt here\"")
	fmt.Fprintln(os.Stderr, "   or: echo \"Your prompt here\" | ka [options]")
	fmt.Fprintln(os.Stderr, "Options:")
	flag.PrintDefaults()
	os.Exit(1)
}

func composeCliSystemMessage(availableToolsMap map[string]tools.Tool) string {
	var allToolNames []string
	for name := range availableToolsMap {
		allToolNames = append(allToolNames, name)
	}

	// System context is now fetched within ComposeSystemPrompt
	// In CLI mode, no MCP servers are selected, so pass an empty slice of McpServerConfig.
	cliSystemMessage := tools.ComposeSystemPrompt(allToolNames, []tools.McpServerConfig{}, availableToolsMap)
	fmt.Printf("[main] Using CLI system message:\n%s\n", cliSystemMessage)
	return cliSystemMessage
}

func sendPromptToLLM(cliLLMClient llm.LLMClient, cliSystemMessage, userPrompt string, stream bool) {
	messages := []llm.Message{
		{Role: "system", Content: cliSystemMessage},
		{Role: "user", Content: userPrompt},
	}

	fmt.Println("[main] Sending prompt to LLM...")
	completion, inputTokens, completionTokens, err := cliLLMClient.Chat(context.Background(), messages, stream, os.Stdout)
	if err != nil {
		fmt.Fprintln(os.Stderr, "LLM error:", err)
		os.Exit(1)
	}

	// Log token usage
	fmt.Fprintf(os.Stderr, "\n[CLI Mode] Input Tokens: %d, Completion Tokens: %d\n", inputTokens, completionTokens)

	// Print final completion if not streaming
	if !stream && completion != "" {
		fmt.Println(completion)
	}
}

func isTerminal(f *os.File) bool {
	fileInfo, err := f.Stat()
	if err != nil {
		return false
	}
	return (fileInfo.Mode() & os.ModeCharDevice) != 0
}
