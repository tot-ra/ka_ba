package a2a

import (
	"sync"

	"ka/llm"
	"ka/tools" // Import the tools package
)

type TaskExecutor struct {
	LLMClient                     llm.LLMClient // Exported LLMClient
	TaskStore                     TaskStore      // Exported TaskStore
	AvailableTools                map[string]tools.Tool // Map of available tools
	SystemMessage                 string // Added SystemMessage field
	mu                            sync.Mutex
	resumeChannels                map[string]chan struct{}
	pushNotificationRegistrations map[string]string // Map taskID to notification URL
}

// NewTaskExecutor creates a new TaskExecutor.
// It now accepts the map of available tools and the system message.
func NewTaskExecutor(client llm.LLMClient, store TaskStore, availableTools map[string]tools.Tool, systemMessage string) *TaskExecutor { // Updated signature
	return &TaskExecutor{
		LLMClient:                     client,         // Assign to exported field
		TaskStore:                     store,          // Assign to exported field
		AvailableTools:                availableTools, // Store the map of available tools
		SystemMessage:                 systemMessage,  // Assign the system message
		mu:                            sync.Mutex{},
		resumeChannels:                make(map[string]chan struct{}),
		pushNotificationRegistrations: make(map[string]string), // Initialize the map
	}
}
