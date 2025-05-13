package main

import (
	"bytes" // Added for request body buffering
	"encoding/json"
	"fmt"
	"io" // Added for io.ReadAll
	"log"
	"net/http"
	// "os"      // No longer needed here
	// "os/user" // No longer needed here
	// "runtime" // No longer needed here
	"strings" // Added for string manipulation
	// "time"    // No longer needed here

	"ka/a2a" // Keep one a2a import
	"ka/llm" // Import llm package
	"ka/tools" // Added for tools.ComposeSystemPrompt and tools.Tool

	"github.com/golang-jwt/jwt/v5" // Keep one jwt import
)

// --- JSON-RPC Structures (Using definitions from a2a package) ---
// Note: We will use the types defined in the a2a package directly
// where possible, or ensure consistency.

// Local alias for clarity in this file, matching a2a.JSONRPCError
type jsonRPCError = a2a.JSONRPCError

// Local alias for clarity, matching a2a.JSONRPCResponse
type jsonRPCResponse = a2a.JSONRPCResponse

// Local alias for clarity, matching a2a.JSONRPCRequest
// We need this specific definition here because the root handler
// needs to parse the raw JSON before knowing the specific params type.
// We keep json.RawMessage for Params.
type jsonRPCRequest struct {
	Jsonrpc string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"` // Use RawMessage like in a2a
	ID      interface{}     `json:"id"`
}

const (
	jsonRPCParseErrorCode      = -32700
	jsonRPCInvalidRequestCode  = -32600
	jsonRPCMethodNotFoundCode  = -32601
	jsonRPCInvalidParamsCode   = -32602
	jsonRPCInternalErrorCode   = -32603
	jsonRPCServerErrorBaseCode = -32000
)

// --- Middleware Definitions (will be instantiated with config) ---

// apiKeyAuthMiddleware creates an API Key Authentication Middleware instance.
// It captures the validKeys map via closure.
func apiKeyAuthMiddleware(validKeys map[string]bool) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			apiKey := r.Header.Get("X-API-Key")
			if apiKey == "" {
				http.Error(w, "X-API-Key header required", http.StatusUnauthorized)
				return
			}

			if _, valid := validKeys[apiKey]; !valid { // Use captured validKeys
				http.Error(w, "Invalid API Key", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		}
	}
}

// jwtAuthMiddleware creates a JWT Authentication Middleware instance.
// It captures the jwtSecret byte slice via closure.
func jwtAuthMiddleware(jwtSecret []byte) func(http.HandlerFunc) http.HandlerFunc {
	return func(next http.HandlerFunc) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			authHeader := r.Header.Get("Authorization")
			if authHeader == "" {
				http.Error(w, "Authorization header required", http.StatusUnauthorized)
				return
			}

			tokenString := strings.TrimPrefix(authHeader, "Bearer ")
			if tokenString == authHeader { // No "Bearer " prefix found
				http.Error(w, "Bearer token required", http.StatusUnauthorized)
				return
			}

			token, err := jwt.Parse(tokenString, func(token *jwt.Token) (interface{}, error) {
				if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
				}
				return jwtSecret, nil // Use captured jwtSecret
			})

			if err != nil || !token.Valid {
				log.Printf("Invalid token: %v", err)
				http.Error(w, "Invalid token", http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r)
		}
	}
}

// --- Handlers ---

// Health check handler
func healthHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// agentCardHandler now accepts the agent card map directly
func agentCardHandler(card map[string]interface{}) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(card) // Encode the passed card
	}
}

// Helper to write JSON-RPC errors (defined before use in jsonRPCHandler)
func writeJSONRPCError(w http.ResponseWriter, id interface{}, code int, message string, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	// Determine appropriate HTTP status code based on JSON-RPC error code if needed
	httpStatusCode := http.StatusInternalServerError // Default
	if code == jsonRPCParseErrorCode || code == jsonRPCInvalidRequestCode || code == jsonRPCInvalidParamsCode {
		httpStatusCode = http.StatusBadRequest
	} else if code == jsonRPCMethodNotFoundCode {
		httpStatusCode = http.StatusNotFound // Or maybe 400 depending on spec interpretation
	}
	// Note: Auth errors are typically handled by middleware directly with 401/403

	w.WriteHeader(httpStatusCode) // Set appropriate HTTP status
	resp := a2a.JSONRPCResponse{  // Use the type from a2a package
		Jsonrpc: "2.0", // Field name is lowercase 'j'
		ID:      id,
		Error: &a2a.JSONRPCError{ // Use the type from a2a package
			Code:    code,
			Message: message,
			Data:    data,
		},
	}
	if err := json.NewEncoder(w).Encode(resp); err != nil {
		log.Printf("Error encoding JSON-RPC error response: %v", err)
	}
}

// startHTTPServer sets up and starts the HTTP server for the agent.
// It now accepts the TaskExecutor, the LLMClient, and the map of available tools.
func startHTTPServer(
		taskExecutor *a2a.TaskExecutor, 
		llmClient *llm.LLMClient, 
		port int, 
		agentName, 
		agentDescription, 
		agentModel, 
		jwtSecretString string, 
		apiKeys []string, 
		availableTools map[string]tools.Tool,
	) {
	// --- Process Auth Configuration ---
	jwtAuthEnabled := jwtSecretString != ""
	apiKeyAuthEnabled := len(apiKeys) > 0

	var actualJwtSecret []byte
	if jwtAuthEnabled {
		actualJwtSecret = []byte(jwtSecretString)
		fmt.Println("[auth] JWT Authentication Enabled")
	}

	actualValidAPIKeys := make(map[string]bool)
	if apiKeyAuthEnabled {
		for _, key := range apiKeys {
			if key != "" { // Avoid empty keys
				actualValidAPIKeys[key] = true
			}
		}
		// Re-check enablement in case only empty keys were passed
		apiKeyAuthEnabled = len(actualValidAPIKeys) > 0
		if apiKeyAuthEnabled {
			fmt.Printf("[auth] API Key Authentication Enabled (%d keys)\n", len(actualValidAPIKeys))
		}
	}

	if !jwtAuthEnabled && !apiKeyAuthEnabled {
		fmt.Println("[auth] No authentication configured.")
	}

	// --- Create Agent Card ---
	agentURL := fmt.Sprintf("http://localhost:%d/", port) // Keep trailing slash for consistency within agent.json
	authMethods := []string{}                             // Change to array of strings as expected by backend TS interface
	if jwtAuthEnabled {
		authMethods = append(authMethods, "jwt") // New format
	}
	if apiKeyAuthEnabled {
		authMethods = append(authMethods, "apiKey") // New format
	}
	if len(authMethods) == 0 {
		authMethods = append(authMethods, "none")
	}

	// Define endpoints (using root path for now as all handled by JSON-RPC)
	endpoints := map[string]string{
		"tasks_send":           "/", // Assuming handled by JSON-RPC method
		"tasks_send_subscribe": "/", // Assuming handled by JSON-RPC method
		"tasks_status":         "/", // Assuming handled by JSON-RPC method
		"tasks_artifact":       "/", // Assuming handled by JSON-RPC method
		"tasks_list":           "/", // Explicitly add list endpoint path (even though handled by root)
		// Add other standard endpoints if implemented, e.g., tasks_input
		"tasks_input": "/",
	}

	dynamicAgentCard := map[string]interface{}{
		"name":             agentName,
		"description":      agentDescription,
		"version":          "0.1.0",         // TODO: Consider making dynamic
		"api_version":      "v1",            // Add missing field
		"protocol_version": "a2a-draft-0.1", // Add missing field
		"url":              agentURL,        // Use dynamic URL with trailing slash
		"endpoints":        endpoints,       // Add the endpoints map
		"capabilities": map[string]interface{}{
			"streaming":         true,
			"pushNotifications": false, // TODO: Implement push notifications
		},
		"skills": []map[string]interface{}{
			{
				"id":          "llm_chat",
				"name":        "Chat with LLM",
				"description": "Conversational LLM interaction via OpenAI-compatible API",
				"inputModes":  []string{"text"},
				"outputModes": []string{"text"},
			},
		},
		"llm_info": map[string]string{
			"model": agentModel,
		},
		"authentication": authMethods, // Use corrected auth methods format (array of strings)
	}

	// The TaskExecutor already holds the llmClient and taskStore.
	// We can access them via taskExecutor.llmClient and taskExecutor.taskStore if needed,
	// but the handlers should ideally just use the taskExecutor.

	// --- Middleware Instantiation (using closures) ---
	var jwtMiddleware func(http.HandlerFunc) http.HandlerFunc
	if jwtAuthEnabled {
		jwtMiddleware = jwtAuthMiddleware(actualJwtSecret) // Create instance with secret
	}

	var apiKeyMiddleware func(http.HandlerFunc) http.HandlerFunc
	if apiKeyAuthEnabled {
		apiKeyMiddleware = apiKeyAuthMiddleware(actualValidAPIKeys) // Create instance with keys
	}

	// --- JSON-RPC Root Handler ---

	// jsonRPCHandler creates the main handler for all JSON-RPC requests at the root path.
	// It captures necessary dependencies like taskStore, taskExecutor, and auth middleware.
	jsonRPCHandler := func(
		taskStore a2a.TaskStore,
		taskExecutor *a2a.TaskExecutor,
		jwtMiddleware func(http.HandlerFunc) http.HandlerFunc,
		apiKeyMiddleware func(http.HandlerFunc) http.HandlerFunc,
		jwtAuthEnabled bool,
		apiKeyAuthEnabled bool,
	) http.HandlerFunc {
		// Map method names to their respective handlers (done inside the handler)

		return func(w http.ResponseWriter, r *http.Request) {
			// ADDED IMMEDIATE ENTRY LOGGING
			log.Printf("[Root Handler Entry] Received request: Method=%s, Path=%s, RemoteAddr=%s", r.Method, r.URL.Path, r.RemoteAddr)

			// ADD EXTRA LOGGING HERE
			log.Printf("[Root Handler Entry] Method=%s, Path=%s, URL=%s, Proto=%s, Header=%v",
				r.Method, r.URL.Path, r.URL.String(), r.Proto, r.Header)

			if r.Method != http.MethodPost {
				log.Printf("[Root Handler] REJECTING Method: %s (Expected POST)", r.Method) // More specific log
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			log.Printf("[Root Handler] Accepted POST request for Path: %s", r.URL.Path) // Log acceptance

			// Read the body
			bodyBytes, err := io.ReadAll(r.Body)
			if err != nil {
				log.Printf("Error reading request body: %v", err)
				writeJSONRPCError(w, nil, jsonRPCInternalErrorCode, "Internal server error reading request body", nil)
				return
			}
			r.Body.Close() // Close the original body

			// Restore the body so middleware (if any) can read it again if needed
			// This is important if middleware needs to inspect the body.
			r.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

			// --- Apply Authentication Middleware ---
			// We need to wrap the core dispatch logic in the auth middleware
			coreLogic := func(w http.ResponseWriter, r *http.Request) {
				// Re-read the body after middleware has potentially consumed it
				// Note: This assumes middleware doesn't modify the body in incompatible ways.
				finalBodyBytes, readErr := io.ReadAll(r.Body)
				if readErr != nil {
					log.Printf("Error reading request body after middleware: %v", readErr)
					writeJSONRPCError(w, nil, jsonRPCInternalErrorCode, "Internal server error reading request body post-auth", nil)
					return
				}
				r.Body.Close() // Close the potentially replaced body

				// ADDED: Log the raw body before attempting to unmarshal
				log.Printf("[Core Logic] Raw request body received: %s", string(finalBodyBytes))

				// Decode the JSON-RPC request
				var req jsonRPCRequest
				if err := json.Unmarshal(finalBodyBytes, &req); err != nil {
					// ADDED: More specific log for unmarshal failure
					log.Printf("[Core Logic] Error decoding JSON-RPC request body: %v. Body was: %s", err, string(finalBodyBytes))
					writeJSONRPCError(w, nil, jsonRPCParseErrorCode, "Parse error: Invalid JSON received", err.Error()) // Modified error message slightly
					return
				}

				// Basic validation
				// Use lowercase 'j' for Jsonrpc field access
				if req.Jsonrpc != "2.0" || req.Method == "" {
					writeJSONRPCError(w, req.ID, jsonRPCInvalidRequestCode, "Invalid Request", "Missing jsonrpc version or method")
					return
				}

				// Use lowercase 'j' for Jsonrpc field access
				log.Printf("Received JSON-RPC request: Method=%s, ID=%v, Version=%s", req.Method, req.ID, req.Jsonrpc)

				// --- Dispatch based on method ---
				// We need to simulate the http.HandlerFunc signature for the existing handlers
				// by creating a new request with the correct body for them to parse.
				// This is somewhat inefficient but avoids rewriting all handlers immediately.

				// Create a new request context with the original body bytes for the target handler
				handlerReq := r.Clone(r.Context())
				handlerReq.Body = io.NopCloser(bytes.NewBuffer(finalBodyBytes)) // Use the final bytes read

				switch req.Method {
				case "tasks/send":
					a2a.TasksSendHandler(taskExecutor)(w, handlerReq)
				case "tasks/status":
					a2a.TasksStatusHandler(taskStore)(w, handlerReq)
				case "tasks/sendSubscribe":
					// Note: sendSubscribe might need special handling if it expects direct streaming response setup
					a2a.TasksSendSubscribeHandler(taskExecutor)(w, handlerReq)
				case "tasks/input":
					a2a.TasksInputHandler(taskExecutor)(w, handlerReq)
				case "tasks/pushNotification/set":
					a2a.TasksPushNotificationSetHandler(taskStore)(w, handlerReq)
				case "tasks/artifact":
					a2a.TasksArtifactHandler(taskStore)(w, handlerReq)
				case "tasks/list": // Handle the list method
					a2a.TasksListHandler(taskStore)(w, handlerReq)
				case "tasks/delete": // Handle the delete method
					a2a.TasksDeleteHandler(taskStore)(w, handlerReq)
				default:
					log.Printf("Method not found: %s", req.Method)
					writeJSONRPCError(w, req.ID, jsonRPCMethodNotFoundCode, "Method not found", req.Method)
				}
			}

			// Apply middleware to the core logic
			handlerWithAuth := coreLogic
			if apiKeyAuthEnabled {
				handlerWithAuth = apiKeyMiddleware(handlerWithAuth)
			}
			if jwtAuthEnabled {
				handlerWithAuth = jwtMiddleware(handlerWithAuth)
			}

			// Execute the handler chain
			handlerWithAuth(w, r)
		}
	}

	// --- Handlers for new endpoints ---

	// toolsHandler lists available tools
	toolsHandler := func(availableTools map[string]tools.Tool) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodGet {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			w.Header().Set("Content-Type", "application/json")

			// Prepare a list of tool definitions suitable for JSON output
			type ToolDefinition struct {
				Name        string `json:"name"`
				Description string `json:"description"`
				XMLDefinition string `json:"xml_definition"` // Add XMLDefinition field
			}
			var toolList []ToolDefinition
			for _, tool := range availableTools {
				toolList = append(toolList, ToolDefinition{
					Name:        tool.GetName(),
					Description: tool.GetDescription(),
					XMLDefinition: tool.GetXMLDefinition(), // Include the XML definition
				})
			}

			// ADDED: Log the toolList before encoding
			log.Printf("[toolsHandler] Tool list before encoding: %+v", toolList)

			encoder := json.NewEncoder(w)
			encoder.SetIndent("", "  ") // Optional: make output readable for debugging

			if err := encoder.Encode(toolList); err != nil {
				// ADDED: Log the encoding error explicitly
				log.Printf("[toolsHandler] Error encoding tools list: %v", err)
				http.Error(w, "Internal server error during tool list encoding", http.StatusInternalServerError)
				return // Ensure we stop processing after sending error
			}

			// ADDED: Log successful encoding
			log.Printf("[toolsHandler] Successfully encoded and sent tool list.")
		}
	}

	// updateSystemPromptHandler updates the agent's system prompt
	updateSystemPromptHandler := func(llmClient *llm.LLMClient) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPut && r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			w.Header().Set("Content-Type", "application/json")

			var requestBody struct {
				SystemPrompt string `json:"systemPrompt"`
			}

			if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
				log.Printf("Error decoding system prompt update request body: %v", err)
				http.Error(w, "Invalid Request Body", http.StatusBadRequest)
				return
			}

			if requestBody.SystemPrompt == "" {
				http.Error(w, "SystemPrompt field is required in the request body", http.StatusBadRequest)
				return
			}

			llmClient.UpdateSystemMessage(requestBody.SystemPrompt) // Call the new method on LLMClient
			log.Printf("System prompt updated successfully.")

			w.WriteHeader(http.StatusOK)
			json.NewEncoder(w).Encode(map[string]string{"status": "success", "message": "System prompt updated"})
		}
	}

	// composePromptHandler composes the system prompt based on selected tools
	composePromptHandler := func(availableTools map[string]tools.Tool) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			if r.Method != http.MethodPost {
				http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
				return
			}
			w.Header().Set("Content-Type", "application/json")

			var requestBody struct {
				ToolNames      []string `json:"toolNames"`
				McpServerNames []string `json:"mcpServerNames"`
			}

			if err := json.NewDecoder(r.Body).Decode(&requestBody); err != nil {
				log.Printf("Error decoding compose prompt request body: %v", err)
				writeJSONRPCError(w, nil, jsonRPCInvalidParamsCode, "Invalid Request Body", "Expected JSON object with toolNames and mcpServerNames arrays")
				return
			}

			// System context is now fetched within ComposeSystemPrompt
			composedPrompt := tools.ComposeSystemPrompt(requestBody.ToolNames, requestBody.McpServerNames, availableTools)

			// Return the composed prompt as a JSON string
			response := map[string]string{"systemPrompt": composedPrompt}
			if err := json.NewEncoder(w).Encode(response); err != nil {
				log.Printf("Error encoding composed prompt response: %v", err)
				http.Error(w, "Internal server error", http.StatusInternalServerError)
			}
		}
	}

	// --- Route Setup ---

	// Public endpoints remain the same
	http.HandleFunc("/.well-known/agent.json", agentCardHandler(dynamicAgentCard))
	http.HandleFunc("/health", healthHandler)

	// New endpoints for tool management, prompt composition, and prompt update
	// Register these specific paths BEFORE the root handler
	http.HandleFunc("/tools", toolsHandler(availableTools))
	http.HandleFunc("/compose-prompt", composePromptHandler(availableTools))
	http.HandleFunc("/system-prompt", updateSystemPromptHandler(llmClient)) // Register the new handler


	// Root handler for all JSON-RPC requests (should be registered last)
	http.HandleFunc("/", jsonRPCHandler(
		taskExecutor.TaskStore, // Pass taskStore from executor
		taskExecutor,
		jwtMiddleware,    // Pass the instantiated middleware
		apiKeyMiddleware, // Pass the instantiated middleware
		jwtAuthEnabled,
		apiKeyAuthEnabled,
	))

	// Specific /tasks/* handlers are now removed as they are handled by the root handler

	// --- Start Server ---
	listenAddr := fmt.Sprintf(":%d", port)
	fmt.Printf("[http] Agent server running at http://localhost:%d/\n", port)
	fmt.Println("[http] Registered Handlers: /.well-known/agent.json, /health, /tools, /compose-prompt, /system-prompt, /") // Updated log message order
	log.Fatal(http.ListenAndServe(listenAddr, nil))
}
