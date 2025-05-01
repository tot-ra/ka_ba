package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"ka/llm"
	"ka/a2a"
)

// Removed global agentCard variable

// agentCardHandler now accepts the agent card map directly
func agentCardHandler(card map[string]interface{}) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(card) // Encode the passed card
	}
}

// Updated signature to accept name, description, model
func startHTTPServer(llmClient *llm.LLMClient, taskStore a2a.TaskStore, port int, agentName, agentDescription, agentModel string) {
	// Create agentCard dynamically
	agentURL := fmt.Sprintf("http://localhost:%d/", port)
	dynamicAgentCard := map[string]interface{}{
		"name":        agentName,        // Use passed name
		"description": agentDescription, // Use passed description
		"version":     "0.1.0",          // Keep static version for now
		"url":         agentURL,         // Use dynamic URL
		"capabilities": map[string]interface{}{
			"streaming": true,
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
	}

	taskExecutor := a2a.NewTaskExecutor(llmClient, taskStore)

	// Use a closure to pass the dynamically created card to the handler
	http.HandleFunc("/.well-known/agent.json", agentCardHandler(dynamicAgentCard))
	http.HandleFunc("/tasks/send", a2a.TasksSendHandler(taskExecutor))
	http.HandleFunc("/tasks/status", a2a.TasksStatusHandler(taskStore))
	http.HandleFunc("/tasks/sendSubscribe", a2a.TasksSendSubscribeHandler(taskExecutor))
	http.HandleFunc("/tasks/input", a2a.TasksInputHandler(taskExecutor))
	http.HandleFunc("/tasks/pushNotification/set", a2a.TasksPushNotificationSetHandler(taskStore))
	http.HandleFunc("/tasks/artifact", a2a.TasksArtifactHandler(taskStore))

	// Use the port variable
	listenAddr := fmt.Sprintf(":%d", port)
	fmt.Printf("[http] Agent server running at http://localhost:%d/\n", port)
	fmt.Println("[http] Endpoints: /.well-known/agent.json, /tasks/send, /tasks/status, /tasks/sendSubscribe, /tasks/input, ...")
	log.Fatal(http.ListenAndServe(listenAddr, nil))
}
