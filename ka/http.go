package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings" // Added for string manipulation

	"ka/a2a"
	"ka/llm"

	"github.com/golang-jwt/jwt/v5" // Added for JWT handling
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

// Removed global agentCard variable

// agentCardHandler now accepts the agent card map directly
func agentCardHandler(card map[string]interface{}) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(card) // Encode the passed card
	}
}

// Updated signature to accept name, description, model, and auth config
func startHTTPServer(llmClient *llm.LLMClient, taskStore a2a.TaskStore, port int, agentName, agentDescription, agentModel, jwtSecretString string, apiKeys []string) {
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
	agentURL := fmt.Sprintf("http://localhost:%d/", port)
	authMethods := []map[string]string{}
	if jwtAuthEnabled {
		authMethods = append(authMethods, map[string]string{
			"scheme":      "Bearer",
			"description": "JWT Bearer token required in Authorization header.",
		})
	}
	if apiKeyAuthEnabled {
		authMethods = append(authMethods, map[string]string{
			"scheme":      "APIKey",
			"headerName":  "X-API-Key",
			"description": "API Key required in X-API-Key header.",
		})
	}

	dynamicAgentCard := map[string]interface{}{
		"name":        agentName,        // Use passed name
		"description": agentDescription, // Use passed description
		"version":     "0.1.0",          // Keep static version for now
		"url":         agentURL,         // Use dynamic URL
		"capabilities": map[string]interface{}{
			"streaming":         true,
			"pushNotifications": false,
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
			"model": agentModel, // Use passed model
		},
		"authentication": authMethods, // Dynamically set auth methods
	}

	taskExecutor := a2a.NewTaskExecutor(llmClient, taskStore)

	// --- Middleware Instantiation (using closures) ---
	var jwtMiddleware func(http.HandlerFunc) http.HandlerFunc
	if jwtAuthEnabled {
		jwtMiddleware = jwtAuthMiddleware(actualJwtSecret) // Create instance with secret
	}

	var apiKeyMiddleware func(http.HandlerFunc) http.HandlerFunc
	if apiKeyAuthEnabled {
		apiKeyMiddleware = apiKeyAuthMiddleware(actualValidAPIKeys) // Create instance with keys
	}

	// --- Helper to Apply Middleware Conditionally ---
	applyAuth := func(baseHandler http.HandlerFunc) http.HandlerFunc {
		handler := baseHandler
		// Apply in reverse order of typical execution (innermost first)
		if apiKeyAuthEnabled {
			handler = apiKeyMiddleware(handler)
		}
		if jwtAuthEnabled {
			handler = jwtMiddleware(handler)
		}
		return handler
	}

	// --- Route Setup ---

	// Public endpoints
	http.HandleFunc("/.well-known/agent.json", agentCardHandler(dynamicAgentCard))
	http.HandleFunc("/health", healthHandler)

	// Protected endpoints - apply middleware conditionally
	http.HandleFunc("/tasks/send", applyAuth(a2a.TasksSendHandler(taskExecutor)))
	http.HandleFunc("/tasks/status", applyAuth(a2a.TasksStatusHandler(taskStore)))
	http.HandleFunc("/tasks/sendSubscribe", applyAuth(a2a.TasksSendSubscribeHandler(taskExecutor)))
	http.HandleFunc("/tasks/input", applyAuth(a2a.TasksInputHandler(taskExecutor)))
	http.HandleFunc("/tasks/pushNotification/set", applyAuth(a2a.TasksPushNotificationSetHandler(taskStore)))
	http.HandleFunc("/tasks/artifact", applyAuth(a2a.TasksArtifactHandler(taskStore)))

	// --- Start Server ---
	listenAddr := fmt.Sprintf(":%d", port)
	fmt.Printf("[http] Agent server running at http://localhost:%d/\n", port)
	fmt.Println("[http] Endpoints: /.well-known/agent.json, /tasks/send, /tasks/status, /tasks/sendSubscribe, /tasks/input, ...")
	log.Fatal(http.ListenAndServe(listenAddr, nil))
}
