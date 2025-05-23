package a2a

import (
	"encoding/json"
	"fmt"
	"log" // Import log package
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

var _ TaskStore = (*FileTaskStore)(nil)

type FileTaskStore struct {
	baseDir string
	mu      sync.RWMutex
}

func NewFileTaskStore(baseDir string) (*FileTaskStore, error) {
	if baseDir == "" {
		baseDir = "_tasks"
	}
	err := os.MkdirAll(baseDir, 0755)
	if err != nil {
		return nil, fmt.Errorf("failed to create task directory %s: %w", baseDir, err)
	}
	return &FileTaskStore{
		baseDir: baseDir,
	}, nil
}

func (fts *FileTaskStore) taskFilePath(taskID string) string {
	return filepath.Join(fts.baseDir, taskID+".json")
}

func (fts *FileTaskStore) saveTask(task *Task) error {
	filePath := fts.taskFilePath(task.ID)
	log.Printf("[FileTaskStore saveTask %s] Marshalling task data...", task.ID) // Added log
	data, err := json.MarshalIndent(task, "", "  ")
	if err != nil {
		log.Printf("[FileTaskStore saveTask %s] Error marshalling task: %v", task.ID, err) // Added log
		return fmt.Errorf("failed to marshal task %s: %w", task.ID, err)
	}
	log.Printf("[FileTaskStore saveTask %s] Writing task data to %s...", task.ID, filePath) // Added log
	err = os.WriteFile(filePath, data, 0644)
	if err != nil {
		log.Printf("[FileTaskStore saveTask %s] Error writing task file %s: %v", task.ID, filePath, err) // Added log
		return fmt.Errorf("failed to write task file %s: %w", filePath, err)
	}
	log.Printf("[FileTaskStore saveTask %s] Successfully wrote task file %s", task.ID, filePath) // Added log
	return nil
}

// loadTask reads and unmarshals a task file.
// IMPORTANT: Locking must be handled by the caller.
func (fts *FileTaskStore) loadTask(taskID string) (*Task, error) {
	// Removed RLock/RUnlock - caller must handle locking

	filePath := fts.taskFilePath(taskID)
	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrTaskNotFound
		}
		return nil, fmt.Errorf("failed to read task file %s: %w", filePath, err)
	}

	var task Task
	err = json.Unmarshal(data, &task)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal task %s from %s: %w", taskID, filePath, err)
	}

	// Correct timestamps for messages if they are the zero value
	// This handles loading tasks that might have been created with default timestamps
	for i := range task.Messages {
		// Check if the timestamp is the zero value (0001-01-01T00:00:00Z)
		if task.Messages[i].Timestamp.IsZero() {
			// Use the task's UpdatedAt or CreatedAt time
			if !task.UpdatedAt.IsZero() {
				task.Messages[i].Timestamp = task.UpdatedAt
			} else {
				task.Messages[i].Timestamp = task.CreatedAt
			}
			// Update the Unix timestamp as well
			task.Messages[i].TimestampUnixMs = task.Messages[i].Timestamp.UnixNano() / int64(time.Millisecond)
		}
	}

	return &task, nil
}

// CreateTask creates a new task with the given name, system prompt, input messages, and parent task ID.
func (fts *FileTaskStore) CreateTask(name string, systemPrompt string, initialMessages []Message, parentTaskID string) (*Task, error) {
	fts.mu.Lock()
	defer fts.mu.Unlock()

	taskID := uuid.NewString()
	now := time.Now().UTC()
	// Initialize messages with timestamps
	messagesWithTimestamps := make([]Message, len(initialMessages))
	for i, msg := range initialMessages {
		msg.Timestamp = now // Add timestamp to initial messages
		messagesWithTimestamps[i] = msg
	}

	task := &Task{
		ID:           taskID,
		Name:         name, // Store the provided name
		State:        TaskStateSubmitted,
		SystemPrompt: systemPrompt, // Store the provided system prompt
		Messages:     messagesWithTimestamps, // Use the new Messages field
		Artifacts:    make(map[string]*Artifact),
		CreatedAt:    now,
		UpdatedAt:    now,
		ParentTaskID: parentTaskID, // Store the parent task ID
	}

	log.Printf("[FileTaskStore CreateTask] Attempting to save task %s (Name: %s, ParentTaskID: %s)...", taskID, name, parentTaskID) // Added log
	err := fts.saveTask(task)
	if err != nil {
		log.Printf("[FileTaskStore CreateTask] Error saving task %s (ParentTaskID: %s): %v", taskID, parentTaskID, err) // Added log
		return nil, fmt.Errorf("failed to save new task %s (ParentTaskID: %s): %w", taskID, parentTaskID, err)
	}
	log.Printf("[FileTaskStore CreateTask] Successfully saved task %s (Name: %s, ParentTaskID: %s).", taskID, name, parentTaskID) // Added log

	return task, nil
}

func (fts *FileTaskStore) GetTask(taskID string) (*Task, error) {
	fts.mu.RLock()
	defer fts.mu.RUnlock()

	task, err := fts.loadTask(taskID)
	if err != nil {
		return nil, err
	}
	return task, nil
}

func (fts *FileTaskStore) UpdateTask(taskID string, updateFn func(*Task) error) (*Task, error) {
	fts.mu.Lock()
	defer fts.mu.Unlock()

	task, err := fts.loadTask(taskID)
	if err != nil {
		return nil, err
	}

	err = updateFn(task)
	if err != nil {
		return nil, fmt.Errorf("update function failed for task %s: %w", taskID, err)
	}

	task.UpdatedAt = time.Now().UTC()

	err = fts.saveTask(task)
	if err != nil {
		return nil, fmt.Errorf("failed to save updated task %s: %w", taskID, err)
	}

	return task, nil
}

func (fts *FileTaskStore) SetState(taskID string, state TaskState) error {
	_, err := fts.UpdateTask(taskID, func(task *Task) error {
		task.State = state
		return nil
	})
	return err
}

func (fts *FileTaskStore) AddMessage(taskID string, message Message) error {
	_, err := fts.UpdateTask(taskID, func(task *Task) error {
		message.Timestamp = time.Now().UTC() // Add timestamp when message is added
		task.Messages = append(task.Messages, message) // Append to the single Messages array
		return nil
	})
	return err
}

func (fts *FileTaskStore) AddArtifact(taskID string, artifact Artifact) error {
	if artifact.ID == "" {
		artifact.ID = uuid.NewString()
	}
	_, err := fts.UpdateTask(taskID, func(task *Task) error {
		if task.Artifacts == nil {
			task.Artifacts = make(map[string]*Artifact)
		}

		artCopy := artifact
		task.Artifacts[artCopy.ID] = &artCopy
		return nil
	})
	return err
}

func (fts *FileTaskStore) GetArtifactData(taskID string, artifactID string) ([]byte, *Artifact, error) {
	fts.mu.RLock()
	defer fts.mu.RUnlock()

	task, err := fts.loadTask(taskID)
	if err != nil {
		return nil, nil, err
	}

	artifact, ok := task.Artifacts[artifactID]
	if !ok {
		return nil, nil, fmt.Errorf("artifact %s not found in task %s", artifactID, taskID)
	}

	return artifact.Data, artifact, nil
}

func (fts *FileTaskStore) ListTasks() ([]*Task, error) {
	fts.mu.RLock()
	defer fts.mu.RUnlock()

	files, err := os.ReadDir(fts.baseDir)
	if err != nil {
		return nil, fmt.Errorf("failed to read task directory %s: %w", fts.baseDir, err)
	}

	var tasks []*Task
	for _, file := range files {
		if file.IsDir() || !strings.HasSuffix(file.Name(), ".json") { // Use strings.HasSuffix
			continue
		}

		taskID := file.Name()[:len(file.Name())-len(".json")]

		task, err := fts.loadTask(taskID)
		if err != nil {
			fmt.Printf("Warning: Failed to load task %s during ListTasks: %v\n", taskID, err)
			continue
		}
		tasks = append(tasks, task)
	}

	return tasks, nil
}

func (fts *FileTaskStore) DeleteTask(taskID string) error {
	fts.mu.Lock()
	defer fts.mu.Unlock()

	filePath := fts.taskFilePath(taskID)

	_, err := os.Stat(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return ErrTaskNotFound
		}
		return fmt.Errorf("failed to check task file %s: %w", filePath, err)
	}

	err = os.Remove(filePath)
	if err != nil {
		return fmt.Errorf("failed to delete task file %s: %w", filePath, err)
	}

	fmt.Printf("[FileTaskStore] Deleted Task: %s\n", taskID)
	return nil
}
