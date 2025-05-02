package a2a

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
)

// SetPushNotificationRequest defines the structure for the /tasks/pushNotification/set endpoint.
// Based on usage in TasksPushNotificationSetHandler.
type SetPushNotificationRequest struct {
	URL string `json:"url"`
	// Potentially other fields like 'events' could be added based on spec.
}

// TasksPushNotificationSetHandler handles POST /tasks/pushNotification/set requests.
// Currently, it's a placeholder acknowledging the request.
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
		if err := json.Unmarshal(body, &req); err != nil || req.URL == "" {
			http.Error(w, "Bad Request: Invalid JSON or missing/invalid url", http.StatusBadRequest)
			return
		}

		log.Printf("[PushNotify] Received registration request for URL: %s (Implementation Pending)", req.URL)

		w.WriteHeader(http.StatusOK)
		fmt.Fprintln(w, `{"message": "Push notification endpoint registered (implementation pending)"}`)
		w.Header().Set("Content-Type", "application/json")
	}
}

// TasksArtifactHandler handles GET /tasks/artifact requests to retrieve task artifacts.
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
