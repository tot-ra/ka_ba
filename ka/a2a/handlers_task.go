package a2a

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
)

// SendTaskRequest defines the structure for the /tasks/send endpoint request body.
type SendTaskRequest struct {
	Input   []Message `json:"input"`
	SkillID string    `json:"skill_id,omitempty"`
	Context string    `json:"context,omitempty"`
	// Add other fields as needed by A2A spec
}

// ProvideInputRequest defines the structure for the /tasks/input endpoint request body.
type ProvideInputRequest struct {
	TaskID string  `json:"task_id"`
	Input  Message `json:"input"`
}

// TasksSendHandler handles the creation of a new task via POST /tasks/send.
// It validates the input, creates the task, starts execution asynchronously,
// and returns the initial task object.
func TasksSendHandler(taskExecutor *TaskExecutor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Bad Request: Cannot read body", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		var req SendTaskRequest

		if err := json.Unmarshal(body, &req); err != nil {
			http.Error(w, "Bad Request: Invalid JSON", http.StatusBadRequest)
			return
		}

		if len(req.Input) == 0 {
			http.Error(w, "Bad Request: Input messages array is empty", http.StatusBadRequest)
			return
		}

		// Add robust input validation based on A2A spec
		for i, msg := range req.Input {
			if msg.Role == "" {
				http.Error(w, fmt.Sprintf("Bad Request: Message %d has empty role", i), http.StatusBadRequest)
				return
			}
			if len(msg.Parts) == 0 {
				http.Error(w, fmt.Sprintf("Bad Request: Message %d has empty parts array", i), http.StatusBadRequest)
				return
			}
			for j, part := range msg.Parts {
				if part == nil {
					http.Error(w, fmt.Sprintf("Bad Request: Message %d, part %d is null", i, j), http.StatusBadRequest)
					return
				}
				// Check concrete part types and their fields
				switch p := part.(type) {
				case TextPart:
					if p.Type == "" {
						http.Error(w, fmt.Sprintf("Bad Request: Message %d, TextPart %d has empty type", i, j), http.StatusBadRequest)
						return
					}
					if p.Text == "" {
						http.Error(w, fmt.Sprintf("Bad Request: Message %d, TextPart %d has empty text", i, j), http.StatusBadRequest)
						return
					}
				case FilePart:
					if p.Type == "" {
						http.Error(w, fmt.Sprintf("Bad Request: Message %d, FilePart %d has empty type", i, j), http.StatusBadRequest)
						return
					}
					if p.URI == "" {
						http.Error(w, fmt.Sprintf("Bad Request: Message %d, FilePart %d has empty URI", i, j), http.StatusBadRequest)
						return
					}
					if p.MimeType == "" {
						http.Error(w, fmt.Sprintf("Bad Request: Message %d, FilePart %d has empty mime_type", i, j), http.StatusBadRequest)
						return
					}
				case DataPart:
					if p.Type == "" {
						http.Error(w, fmt.Sprintf("Bad Request: Message %d, DataPart %d has empty type", i, j), http.StatusBadRequest)
						return
					}
					// Validate Data field (which is 'any')
					if p.Data == nil {
						http.Error(w, fmt.Sprintf("Bad Request: Message %d, DataPart %d has null data", i, j), http.StatusBadRequest)
						return
					}
					// Check if the underlying data has content.
					hasContent := false
					switch dataVal := p.Data.(type) {
					case string:
						if dataVal != "" {
							hasContent = true
						}
					case []byte: // This is the most likely intended type for raw data
						if len(dataVal) > 0 {
							hasContent = true
						}
					case []any: // For JSON arrays
						if len(dataVal) > 0 {
							hasContent = true
						}
					case map[string]any: // For JSON objects
						if len(dataVal) > 0 {
							hasContent = true
						}
					default:
						// If it's a different type, consider it an error for strict validation.
						log.Printf("[TaskSend] Warning: DataPart data field has unexpected type %T for message %d, part %d", dataVal, i, j)
						http.Error(w, fmt.Sprintf("Bad Request: Message %d, DataPart %d has unexpected data type %T", i, j, dataVal), http.StatusBadRequest)
						return
					}

					if !hasContent {
						http.Error(w, fmt.Sprintf("Bad Request: Message %d, DataPart %d has empty data content", i, j), http.StatusBadRequest)
						return
					}

					if p.MimeType == "" {
						http.Error(w, fmt.Sprintf("Bad Request: Message %d, DataPart %d has empty mime_type", i, j), http.StatusBadRequest)
						return
					}
				default:
					// This case should ideally not be hit if UnmarshalJSON for Message/Part works correctly,
					// but added as a safeguard.
					http.Error(w, fmt.Sprintf("Bad Request: Message %d, part %d has unknown type", i, j), http.StatusBadRequest)
					return
				}
			}
		}

		log.Printf("[TaskSend] Received %d input messages. Validation successful.", len(req.Input))

		task, err := taskExecutor.taskStore.CreateTask(req.Input)
		if err != nil {
			log.Printf("[TaskSend] Error creating task: %v", err)
			http.Error(w, "Internal Server Error: Failed to create task", http.StatusInternalServerError)
			return
		}

		// Start task execution asynchronously
		taskExecutor.ExecuteTask(task, r.Context())

		// FIXED: Return the full initial task object as the response
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK) // Use 200 OK as we are returning the created resource representation
		if err := json.NewEncoder(w).Encode(task); err != nil {
			// Log error if encoding fails, headers might already be sent
			log.Printf("[TaskSend %s] Error encoding task response: %v", task.ID, err)
			// Avoid writing http.Error here as headers are likely sent
		}
	}
}

// TasksStatusHandler handles GET /tasks/status requests to retrieve the status of a specific task.
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

// TasksInputHandler handles POST /tasks/input requests to provide additional input
// to a task that is in the TaskStateInputRequired state.
func TasksInputHandler(taskExecutor *TaskExecutor) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, "Bad Request: Cannot read body", http.StatusBadRequest)
			return
		}
		defer r.Body.Close()

		var req ProvideInputRequest
		if err := json.Unmarshal(body, &req); err != nil || req.TaskID == "" {
			http.Error(w, "Bad Request: Invalid JSON or missing task_id", http.StatusBadRequest)
			return
		}

		log.Printf("[TaskInput %s] Received input request.", req.TaskID)

		task, err := taskExecutor.taskStore.GetTask(req.TaskID)
		if err != nil {
			if errors.Is(err, ErrTaskNotFound) {
				http.Error(w, "Not Found: Task not found", http.StatusNotFound)
			} else {
				log.Printf("[TaskInput %s] Error retrieving task: %v", req.TaskID, err)
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
			return
		}

		if task.State != TaskStateInputRequired {
			log.Printf("[TaskInput %s] Task is not in input-required state (current: %s)", req.TaskID, task.State)
			http.Error(w, "Conflict: Task is not waiting for input", http.StatusConflict)
			return
		}

		_, updateErr := taskExecutor.taskStore.UpdateTask(req.TaskID, func(task *Task) error {
			task.Input = append(task.Input, req.Input)
			task.Error = ""
			return nil
		})
		if updateErr != nil {
			log.Printf("[TaskInput %s] Failed to update task with new input: %v", req.TaskID, updateErr)
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}

		resumeErr := taskExecutor.ResumeTask(req.TaskID)
		if resumeErr != nil {
			log.Printf("[TaskInput %s] Failed to resume task: %v", req.TaskID, resumeErr)
			http.Error(w, fmt.Sprintf("Internal Server Error: Failed to resume task processing: %v", resumeErr), http.StatusInternalServerError)
			return
		}

		log.Printf("[TaskInput %s] Input received and task %s signaled to resume.", req.TaskID, req.TaskID)

		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, `{"message": "Input received, task processing resumed."}`)
		w.Header().Set("Content-Type", "application/json")
	}
}

// TasksListHandler retrieves all tasks from the store.
// It's called via the JSON-RPC dispatcher which uses POST, so the method check is removed.
func TasksListHandler(taskStore TaskStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Removed: if r.Method != http.MethodGet check

		log.Println("[TaskList] Received request to list all tasks (via JSON-RPC dispatcher).")

		tasks, err := taskStore.ListTasks() // Use the existing ListTasks method
		if err != nil {
			log.Printf("[TaskList] Error retrieving tasks: %v", err)
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}

		if tasks == nil {
			// Ensure we return an empty array, not null, if no tasks exist
			tasks = []*Task{}
		}

		log.Printf("[TaskList] Retrieved %d tasks.", len(tasks))

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		if err := json.NewEncoder(w).Encode(tasks); err != nil {
			// Log error if encoding fails, but headers might already be sent
			log.Printf("[TaskList] Error encoding tasks response: %v", err)
		}
	}
}
