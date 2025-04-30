package a2a

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

type SendTaskRequest struct {
	Input []Message `json:"input"`
}

type SendTaskResponse struct {
	TaskID string `json:"task_id"`
}

type ProvideInputRequest struct {
	TaskID string  `json:"task_id"`
	Input  Message `json:"input"`
}

type SetPushNotificationRequest struct {
	TargetURL string `json:"target_url"`
}

type SSEWriter struct {
	w       http.ResponseWriter
	flusher http.Flusher
	ctx     context.Context
}

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

		if err := json.Unmarshal(body, &req); err != nil || len(req.Input) == 0 {
			http.Error(w, "Bad Request: Invalid JSON or missing/empty input messages", http.StatusBadRequest)
			return
		}

		log.Printf("[TaskSend] Received %d input messages.", len(req.Input))

		task, err := taskExecutor.taskStore.CreateTask(req.Input)
		if err != nil {
			log.Printf("[TaskSend] Error creating task: %v", err)
			http.Error(w, "Internal Server Error: Failed to create task", http.StatusInternalServerError)
			return
		}

		taskExecutor.ExecuteTask(task, r.Context())

		resp := SendTaskResponse{TaskID: task.ID}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		json.NewEncoder(w).Encode(resp)
	}
}

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

		var req SendTaskRequest

		if err := json.Unmarshal(body, &req); err != nil || len(req.Input) == 0 {
			http.Error(w, "Bad Request: Invalid JSON or missing/empty input messages", http.StatusBadRequest)
			return
		}

		log.Printf("[TaskSendSubscribe] Received %d input messages.", len(req.Input))

		task, err := taskExecutor.taskStore.CreateTask(req.Input)
		if err != nil {
			log.Printf("[TaskSendSubscribe] Error creating task: %v", err)
			http.Error(w, "Internal Server Error: Failed to create task", http.StatusInternalServerError)
			return
		}
		taskID := task.ID
		log.Printf("[Task %s] Received sendSubscribe request\n", taskID)

		sseWriter, err := NewSSEWriter(w, r.Context())
		if err != nil {
			log.Printf("[Task %s] Failed to initialize SSE: %v\n", taskID, err)
			return
		}

		go sseWriter.KeepAlive(20 * time.Second)

		initialStateData, _ := json.Marshal(map[string]string{"task_id": taskID, "status": string(TaskStateSubmitted)})
		sseWriter.SendEvent("state", string(initialStateData))

		taskExecutor.ExecuteTaskStream(task, r.Context(), sseWriter)

		log.Printf("[Task %s] sendSubscribe handler finished, streaming delegated to executor.\n", taskID)
	}
}

func TasksPushNotificationSetHandler(taskStore TaskStore) http.HandlerFunc {
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

		var req SetPushNotificationRequest
		if err := json.Unmarshal(body, &req); err != nil || req.TargetURL == "" {
			http.Error(w, "Bad Request: Invalid JSON or missing/invalid target_url", http.StatusBadRequest)
			return
		}

		log.Printf("[PushNotify] Received registration request for URL: %s (Implementation Pending)", req.TargetURL)

		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, `{"message": "Push notification endpoint registered (implementation pending)"}`)
		w.Header().Set("Content-Type", "application/json")
	}
}

func TasksArtifactHandler(taskStore TaskStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
			return
		}

		taskID := r.URL.Query().Get("id")
		artifactID := r.URL.Query().Get("artifact_id")

		if taskID == "" || artifactID == "" {
			http.Error(w, "Bad Request: Missing 'id' (task_id) or 'artifact_id' query parameter", http.StatusBadRequest)
			return
		}

		data, artifact, err := taskStore.GetArtifactData(taskID, artifactID)
		if err != nil {
			log.Printf("[Artifact] Failed to retrieve artifact '%s' for task '%s': %v", artifactID, taskID, err)
			if errors.Is(err, ErrTaskNotFound) {
				http.Error(w, fmt.Sprintf("Not Found: %v", err), http.StatusNotFound)
			} else {
				http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			}
			return
		}

		log.Printf("[Artifact] Serving artifact '%s' (Type: %s, Size: %d bytes) for task '%s'", artifactID, artifact.Type, len(data), taskID)

		contentType := artifact.Type
		if contentType == "" {
			contentType = "application/octet-stream"
		}
		w.Header().Set("Content-Type", contentType)

		if artifact.Filename != "" {
			disposition := fmt.Sprintf("attachment; filename=\"%s\"", artifact.Filename)
			w.Header().Set("Content-Disposition", disposition)
		}

		_, writeErr := w.Write(data)
		if writeErr != nil {
			log.Printf("[Artifact] Error writing artifact data for task %s, artifact %s: %v", taskID, artifactID, writeErr)
		}
	}
}

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
