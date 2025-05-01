package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"ka/llm"
	"ka/a2a"
)

var agentCard = map[string]interface{}{
	"name":        "ka AI agent",
	"description": "A2A-compatible agent runtime in Go with LLM backend (LM Studio or others)",
	"version": "0.1.0",
	// URL will be updated dynamically in startHTTPServer
	"url": "",
	"capabilities": map[string]interface{}{
		"streaming": true,
		"pushNotifications": false,
	},
	"skills": []map[string]interface{}{
		{
			"id": "llm_chat",
			"name": "Chat with LLM",
			"description": "Conversational LLM interaction via OpenAI-compatible API",
			"inputModes": []string{"text"},
			"outputModes": []string{"text"},
		},
	},
	"llm_info": map[string]string{
		"model": "unknown",
	},
}

func agentCardHandler(llmClient *llm.LLMClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		currentAgentCard := make(map[string]interface{})
		for k, v := range agentCard {
			currentAgentCard[k] = v
		}

		if llmClient != nil {
			currentAgentCard["llm_info"] = map[string]string{
				"model": llmClient.Model,
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(currentAgentCard)
	}
}

// Added port parameter
func startHTTPServer(llmClient *llm.LLMClient, taskStore a2a.TaskStore, port int) {
	// Update agentCard URL dynamically
	agentCard["url"] = fmt.Sprintf("http://localhost:%d/", port)

	taskExecutor := a2a.NewTaskExecutor(llmClient, taskStore)

	http.HandleFunc("/.well-known/agent.json", agentCardHandler(llmClient))
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
