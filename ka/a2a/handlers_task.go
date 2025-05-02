package a2a

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
)

// --- JSON-RPC Structures ---

// JSONRPCRequest represents a generic JSON-RPC request.
type JSONRPCRequest struct {
	Jsonrpc string          `json:"jsonrpc"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"` // Use RawMessage to delay parsing
	ID      interface{}     `json:"id"`               // Can be string, number, or null
}

// JSONRPCError represents the error object in a JSON-RPC response.
type JSONRPCError struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// JSONRPCResponse represents a generic JSON-RPC response.
type JSONRPCResponse struct {
	Jsonrpc string        `json:"jsonrpc"`
	Result  interface{}   `json:"result,omitempty"`
	Error   *JSONRPCError `json:"error,omitempty"`
	ID      interface{}   `json:"id"`
}

// --- Specific Request Parameter Structures ---

// SendTaskParams defines the structure for the parameters of the "tasks/send" method.
// Note: Renamed from SendTaskRequest to avoid confusion with JSONRPCRequest.
type SendTaskParams struct {
	// The original A2AClient sends a 'message' field, not 'input'. Let's align with that.
	// Input   []Message `json:"input"` // Original field
	Message Message `json:"message"` // Aligning with a2aClient.ts TaskSendParams
	// Add other fields from TaskSendParams in a2aClient.ts if needed
	SessionID      *string     `json:"sessionId,omitempty"`
	PushNotification interface{} `json:"pushNotification,omitempty"`
	HistoryLength  *int        `json:"historyLength,omitempty"`
	Metadata       interface{} `json:"metadata,omitempty"`
	// SkillID string    `json:"skill_id,omitempty"` // Keep if needed
	// Context string    `json:"context,omitempty"` // Keep if needed
}

// ProvideInputParams defines the structure for the parameters of the "tasks/input" method.
// Note: Renamed from ProvideInputRequest.
type ProvideInputParams struct {
	TaskID string  `json:"id"` // Aligning with a2aClient.ts TaskInputParams
	Input  Message `json:"message"` // Aligning with a2aClient.ts TaskInputParams
	Metadata interface{} `json:"metadata,omitempty"`
}

// TaskStatusParams defines the structure for parameters of "tasks/status", "tasks/artifact" etc.
type TaskStatusParams struct {
	ID string `json:"id"`
	Metadata interface{} `json:"metadata,omitempty"`
}

// --- Helper Function for Sending JSON-RPC Response ---

func sendJSONRPCResponse(w http.ResponseWriter, id interface{}, result interface{}, jsonrpcError *JSONRPCError) {
	w.Header().Set("Content-Type", "application/json")
	// JSON-RPC spec usually uses 200 OK even for errors in the response body
	w.WriteHeader(http.StatusOK)

	response := JSONRPCResponse{
		Jsonrpc: "2.0",
		ID:      id, // Use the ID from the original request
		Result:  result,
		Error:   jsonrpcError,
	}

	if err := json.NewEncoder(w).Encode(response); err != nil {
		// Log error, but headers are likely already sent
		log.Printf("[JSONRPC] Error encoding response for ID %v: %v", id, err)
	}
}

// --- JSON-RPC Method Handlers ---

// TasksSendHandler handles the "tasks/send" JSON-RPC method.
func TasksSendHandler(taskExecutor *TaskExecutor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 1. Decode the generic JSON-RPC Request
		body, err := io.ReadAll(r.Body)
		if err != nil {
			// Cannot construct a proper JSON-RPC error response without the ID
			http.Error(w, `{"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error: Cannot read body"}, "id": null}`, http.StatusOK)
			return
		}
		defer r.Body.Close()

		var rpcReq JSONRPCRequest
		if err := json.Unmarshal(body, &rpcReq); err != nil {
			http.Error(w, `{"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error: Invalid JSON"}, "id": null}`, http.StatusOK)
			return
		}

		// Basic validation of the RPC request itself
		if rpcReq.Jsonrpc != "2.0" || rpcReq.Method == "" {
			sendJSONRPCResponse(w, rpcReq.ID, nil, &JSONRPCError{Code: -32600, Message: "Invalid Request: Missing jsonrpc version or method"})
			return
		}

		// 2. Decode the specific method parameters (`params`)
		var params SendTaskParams
		if err := json.Unmarshal(rpcReq.Params, &params); err != nil {
			sendJSONRPCResponse(w, rpcReq.ID, nil, &JSONRPCError{Code: -32602, Message: fmt.Sprintf("Invalid Params: %v", err)})
			return
		}

		// 3. Validate the parameters (SendTaskParams)
		// Use the 'Message' field now instead of 'Input' array
		if params.Message.Role == "" {
			sendJSONRPCResponse(w, rpcReq.ID, nil, &JSONRPCError{Code: -32602, Message: "Invalid Params: Message has empty role"})
			return
		}
		if len(params.Message.Parts) == 0 {
			sendJSONRPCResponse(w, rpcReq.ID, nil, &JSONRPCError{Code: -32602, Message: "Invalid Params: Message has empty parts array"})
			return
		}
		// Add more detailed part validation if needed (similar to previous version)
		// ... (validation logic for parts can be added here) ...

		log.Printf("[TaskSend %v] Received valid JSON-RPC request.", rpcReq.ID)

		// 4. Execute the business logic (create and start task)
		// We need to wrap the single message in an array for CreateTask if it still expects []Message
		// TODO: Refactor CreateTask to accept a single Message or adjust here.
		// Assuming CreateTask needs []Message for now:
		inputMessages := []Message{params.Message}
		task, err := taskExecutor.taskStore.CreateTask(inputMessages)
		if err != nil {
			log.Printf("[TaskSend %v] Error creating task: %v", rpcReq.ID, err)
			sendJSONRPCResponse(w, rpcReq.ID, nil, &JSONRPCError{Code: -32000, Message: "Internal Server Error: Failed to create task", Data: err.Error()})
			return
		}

		// Start task execution asynchronously
		taskExecutor.ExecuteTask(task, r.Context()) // Pass request context

		log.Printf("[TaskSend %v] Task %s created successfully.", rpcReq.ID, task.ID)

		// 5. Send the successful JSON-RPC Response containing the task
		sendJSONRPCResponse(w, rpcReq.ID, task, nil)
	}
}


// TasksStatusHandler handles GET /tasks/status requests to retrieve the status of a specific task.
// NOTE: This handler seems intended for standard HTTP GET, not JSON-RPC.
// If it needs to be JSON-RPC, it should follow the pattern of TasksSendHandler.
// Assuming it remains HTTP GET for now.
func TasksStatusHandler(taskStore TaskStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		taskID := r.URL.Query().Get("id")
		if taskID == "" {
			http.Error(w, "Bad Request: Missing task ID", http.StatusBadRequest)
			return
		}

		task, err := taskStore.GetTask(taskID)
		if err != nil {
			if errors.Is(err, ErrTaskNotFound) {
				http.Error(w, "Not Found: Task not found", http.StatusNotFound)
			} else {
				log.Printf("[TaskStatus %s] Error retrieving task: %v", taskID, err)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
			return
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(task)
	}
}

// TasksInputHandler handles the "tasks/input" JSON-RPC method.
func TasksInputHandler(taskExecutor *TaskExecutor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 1. Decode the generic JSON-RPC Request
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, `{"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error: Cannot read body"}, "id": null}`, http.StatusOK)
			return
		}
		defer r.Body.Close()

		var rpcReq JSONRPCRequest
		if err := json.Unmarshal(body, &rpcReq); err != nil {
			http.Error(w, `{"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error: Invalid JSON"}, "id": null}`, http.StatusOK)
			return
		}

		if rpcReq.Jsonrpc != "2.0" || rpcReq.Method == "" {
			sendJSONRPCResponse(w, rpcReq.ID, nil, &JSONRPCError{Code: -32600, Message: "Invalid Request"})
			return
		}

		// 2. Decode the specific method parameters (`params`)
		var params ProvideInputParams
		if err := json.Unmarshal(rpcReq.Params, &params); err != nil || params.TaskID == "" {
			sendJSONRPCResponse(w, rpcReq.ID, nil, &JSONRPCError{Code: -32602, Message: fmt.Sprintf("Invalid Params: %v or missing task ID", err)})
			return
		}

		log.Printf("[TaskInput %v] Received input request for task %s.", rpcReq.ID, params.TaskID)

		// 3. Business Logic
		task, err := taskExecutor.taskStore.GetTask(params.TaskID)
		if err != nil {
			errCode := -32000 // Internal server error default
			errMsg := "Internal Server Error"
			if errors.Is(err, ErrTaskNotFound) {
				errCode = -32001 // Application-specific error code
				errMsg = "Not Found: Task not found"
			} else {
				log.Printf("[TaskInput %v] Error retrieving task %s: %v", rpcReq.ID, params.TaskID, err)
			}
			sendJSONRPCResponse(w, rpcReq.ID, nil, &JSONRPCError{Code: errCode, Message: errMsg, Data: err.Error()})
			return
		}

		if task.State != TaskStateInputRequired {
			log.Printf("[TaskInput %v] Task %s is not in input-required state (current: %s)", rpcReq.ID, params.TaskID, task.State)
			sendJSONRPCResponse(w, rpcReq.ID, nil, &JSONRPCError{Code: -32002, Message: "Conflict: Task is not waiting for input"})
			return
		}

		// Update task with new input
		_, updateErr := taskExecutor.taskStore.UpdateTask(params.TaskID, func(task *Task) error {
			// Assuming task.Input is []Message, append the new message
			task.Input = append(task.Input, params.Input)
			task.Error = "" // Clear previous error if any
			return nil
		})
		if updateErr != nil {
			log.Printf("[TaskInput %v] Failed to update task %s with new input: %v", rpcReq.ID, params.TaskID, updateErr)
			sendJSONRPCResponse(w, rpcReq.ID, nil, &JSONRPCError{Code: -32000, Message: "Internal Server Error: Failed to store input", Data: updateErr.Error()})
			return
		}

		// Resume task processing
		resumeErr := taskExecutor.ResumeTask(params.TaskID)
		if resumeErr != nil {
			log.Printf("[TaskInput %v] Failed to resume task %s: %v", rpcReq.ID, params.TaskID, resumeErr)
			sendJSONRPCResponse(w, rpcReq.ID, nil, &JSONRPCError{Code: -32000, Message: "Internal Server Error: Failed to resume task processing", Data: resumeErr.Error()})
			return
		}

		log.Printf("[TaskInput %v] Input received for task %s and task signaled to resume.", rpcReq.ID, params.TaskID)

		// 4. Send successful JSON-RPC Response
		// A2A spec for tasks/input returns the updated Task object
		updatedTask, _ := taskExecutor.taskStore.GetTask(params.TaskID) // Fetch again to get latest state
		sendJSONRPCResponse(w, rpcReq.ID, updatedTask, nil) // Return updated task
	}
}


// TasksListHandler handles the "tasks/list" JSON-RPC method.
func TasksListHandler(taskStore TaskStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// 1. Decode the generic JSON-RPC Request
		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, `{"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error: Cannot read body"}, "id": null}`, http.StatusOK)
			return
		}
		defer r.Body.Close()

		var rpcReq JSONRPCRequest
		if err := json.Unmarshal(body, &rpcReq); err != nil {
			http.Error(w, `{"jsonrpc": "2.0", "error": {"code": -32700, "message": "Parse error: Invalid JSON"}, "id": null}`, http.StatusOK)
			return
		}

		if rpcReq.Jsonrpc != "2.0" || rpcReq.Method == "" {
			sendJSONRPCResponse(w, rpcReq.ID, nil, &JSONRPCError{Code: -32600, Message: "Invalid Request"})
			return
		}

		// 2. No parameters expected for tasks/list, proceed to business logic

		log.Printf("[TaskList %v] Received request to list all tasks.", rpcReq.ID)

		// 3. Business Logic
		tasks, err := taskStore.ListTasks()
		if err != nil {
			log.Printf("[TaskList %v] Error retrieving tasks: %v", rpcReq.ID, err)
			sendJSONRPCResponse(w, rpcReq.ID, nil, &JSONRPCError{Code: -32000, Message: "Internal Server Error: Failed to retrieve tasks", Data: err.Error()})
			return
		}

		if tasks == nil {
			tasks = []*Task{} // Ensure empty array, not null
		}

		log.Printf("[TaskList %v] Retrieved %d tasks.", rpcReq.ID, len(tasks))

		// 4. Send successful JSON-RPC Response
		sendJSONRPCResponse(w, rpcReq.ID, tasks, nil)
	}
}
