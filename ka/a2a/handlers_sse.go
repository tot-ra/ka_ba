package a2a

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

// SSEWriter wraps an http.ResponseWriter to provide Server-Sent Events functionality.
type SSEWriter struct {
	w       http.ResponseWriter
	flusher http.Flusher
	ctx     context.Context
}

// NewSSEWriter creates and initializes a new SSEWriter.
// It sets the necessary headers and flushes them immediately.
func NewSSEWriter(w http.ResponseWriter, ctx context.Context) (*SSEWriter, error) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil, fmt.Errorf("streaming unsupported")
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.WriteHeader(http.StatusOK)
	flusher.Flush()

	return &SSEWriter{w: w, flusher: flusher, ctx: ctx}, nil
}

// SendEvent sends a named event with data to the client.
func (sw *SSEWriter) SendEvent(event, data string) error {
	select {
	case <-sw.ctx.Done():
		log.Println("[SSE] Client disconnected")
		return sw.ctx.Err()
	default:
	}

	if event != "" {
		fmt.Fprintf(sw.w, "event: %s\n", event)
	}
	fmt.Fprintf(sw.w, "data: %s\n\n", data)

	sw.flusher.Flush()
	return nil
}

// Write implements the io.Writer interface for SSEWriter.
// It marshals the byte slice into a JSON object {"chunk": "..."} and sends it as a "message" event.
func (sw *SSEWriter) Write(p []byte) (int, error) {
	jsonData, err := json.Marshal(map[string]string{"chunk": string(p)})
	if err != nil {
		log.Printf("[SSE] Error marshalling chunk: %v. Sending raw.", err)
		err = sw.SendEvent("message", string(p))
	} else {
		err = sw.SendEvent("message", string(jsonData))
	}

	if err != nil {
		return 0, err
	}
	return len(p), nil
}

// KeepAlive sends periodic keepalive comments to prevent connection closure.
func (sw *SSEWriter) KeepAlive(interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			if _, err := fmt.Fprintf(sw.w, ": keepalive\n\n"); err != nil {
				log.Printf("[SSE] KeepAlive write error: %v", err)
				return
			}
			sw.flusher.Flush()
		case <-sw.ctx.Done():
			log.Println("[SSE] KeepAlive stopping due to client disconnect.")
			return
		}
	}
}

// TasksSendSubscribeHandler handles POST /tasks/sendSubscribe requests.
// It creates a task, initializes an SSE connection, sends the initial task state,
// and then delegates streaming updates to the TaskExecutor.
func TasksSendSubscribeHandler(taskExecutor *TaskExecutor) http.HandlerFunc {
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

		// NOTE: This handler assumes a direct HTTP POST, not JSON-RPC like the others were changed to.
		// If this endpoint *should* be JSON-RPC, it needs the full JSONRPCRequest/Response handling.
		// Assuming direct POST for now, matching the original structure but using the renamed type.
		var params SendTaskParams // Use the renamed struct from handlers_task.go

		// Unmarshal the body directly into the params struct (assuming non-JSON-RPC)
		if err := json.Unmarshal(body, &params); err != nil {
			http.Error(w, "Bad Request: Invalid JSON", http.StatusBadRequest)
			return
		}

		// Validate the Message field within the params
		if params.Message.Role == "" {
			http.Error(w, "Bad Request: Message has empty role", http.StatusBadRequest)
			return
		}
		if len(params.Message.Parts) == 0 {
			http.Error(w, "Bad Request: Message has empty parts array", http.StatusBadRequest)
			return
		}

		// Add robust input validation based on A2A spec (adapted for single message)
		msg := params.Message // Use the single message
		for j, part := range msg.Parts {
			if part == nil {
				http.Error(w, fmt.Sprintf("Bad Request: Message part %d is null", j), http.StatusBadRequest)
				return
			}
			// Check concrete part types and their fields
			switch p := part.(type) {
			case TextPart:
				if p.Type == "" {
					http.Error(w, fmt.Sprintf("Bad Request: TextPart %d has empty type", j), http.StatusBadRequest)
					return
				}
				if p.Text == "" {
					http.Error(w, fmt.Sprintf("Bad Request: TextPart %d has empty text", j), http.StatusBadRequest)
					return
				}
			case FilePart:
				if p.Type == "" {
					http.Error(w, fmt.Sprintf("Bad Request: FilePart %d has empty type", j), http.StatusBadRequest)
					return
				}
				if p.URI == "" {
					http.Error(w, fmt.Sprintf("Bad Request: FilePart %d has empty URI", j), http.StatusBadRequest)
					return
				}
				if p.MimeType == "" {
					http.Error(w, fmt.Sprintf("Bad Request: FilePart %d has empty mime_type", j), http.StatusBadRequest)
					return
				}
			case DataPart:
				if p.Type == "" {
					http.Error(w, fmt.Sprintf("Bad Request: DataPart %d has empty type", j), http.StatusBadRequest)
					return
				}
				// Validate Data field (which is 'any')
				if p.Data == nil {
					http.Error(w, fmt.Sprintf("Bad Request: DataPart %d has null data", j), http.StatusBadRequest)
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
					log.Printf("[TaskSendSubscribe] Warning: DataPart data field has unexpected type %T for part %d", dataVal, j)
					http.Error(w, fmt.Sprintf("Bad Request: DataPart %d has unexpected data type %T", j, dataVal), http.StatusBadRequest)
					return
				}

				if !hasContent {
					http.Error(w, fmt.Sprintf("Bad Request: DataPart %d has empty data content", j), http.StatusBadRequest)
					return
				}

				if p.MimeType == "" {
					http.Error(w, fmt.Sprintf("Bad Request: DataPart %d has empty mime_type", j), http.StatusBadRequest)
					return
				}
			default:
				// This case should ideally not be hit if UnmarshalJSON for Message/Part works correctly,
				// but added as a safeguard.
				http.Error(w, fmt.Sprintf("Bad Request: part %d has unknown type", j), http.StatusBadRequest)
				return
			}
		}

		log.Printf("[TaskSendSubscribe] Received valid input message. Validation successful.")

		// Extract task name from the first text part of the input message
		taskName := "Unnamed Task" // Default name
		for _, part := range params.Message.Parts {
			if textPart, ok := part.(TextPart); ok {
				taskName = textPart.Text
				break // Use the first text part found as the name
			}
		}

		// Create task using the single message, wrapped in a slice for CreateTask
		// Pass the task name, system message from the TaskExecutor, and the input message
		// For tasks created directly via API, parentTaskID is an empty string.
		task, err := taskExecutor.TaskStore.CreateTask(taskName, taskExecutor.SystemMessage, []Message{params.Message}, "")
		if err != nil {
			log.Printf("[TaskSendSubscribe] Error creating task: %v", err)
			http.Error(w, "Internal Server Error: Failed to create task", http.StatusInternalServerError)
			return
		}
		taskID := task.ID
		log.Printf("[Task %s] Received sendSubscribe request (Name: %s)\n", taskID, taskName)

		sseWriter, err := NewSSEWriter(w, r.Context())
		if err != nil {
			log.Printf("[Task %s] Failed to initialize SSE: %v\n", taskID, err)
			// Don't write http.Error here, as headers might have been partially sent by NewSSEWriter
			return
		}

		go sseWriter.KeepAlive(20 * time.Second)

		initialStateData, _ := json.Marshal(map[string]string{"task_id": taskID, "status": string(TaskStateSubmitted)})
		sseWriter.SendEvent("state", string(initialStateData)) // Send initial state

		// Delegate the rest of the streaming to the executor
		taskExecutor.ExecuteTaskStream(r.Context(), task, sseWriter) // Pass context, task, and writer

		log.Printf("[Task %s] sendSubscribe handler finished, streaming delegated to executor.\n", taskID)
		// The response is kept open by ExecuteTaskStream
	}
}
