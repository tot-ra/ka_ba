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

func (fts *FileTaskStore) loadTask(taskID string) (*Task, error) {
	fts.mu.RLock()
	defer fts.mu.RUnlock()

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
	return &task, nil
}

func (fts *FileTaskStore) CreateTask(initialMessages []Message) (*Task, error) {
	fts.mu.Lock()
	defer fts.mu.Unlock()

	taskID := uuid.NewString()
	now := time.Now().UTC()
	task := &Task{
		ID:        taskID,
		State:     TaskStateSubmitted,
		Input:     initialMessages,
		Output:    []Message{},
		Artifacts: make(map[string]*Artifact),
		CreatedAt: now,
		UpdatedAt: now, // Added missing comma here
	} // Close the struct literal here

	log.Printf("[FileTaskStore CreateTask] Attempting to save task %s...", taskID) // Added log
	err := fts.saveTask(task)
	if err != nil {
		log.Printf("[FileTaskStore CreateTask] Error saving task %s: %v", taskID, err) // Added log
		return nil, fmt.Errorf("failed to save new task %s: %w", taskID, err)
	}
	log.Printf("[FileTaskStore CreateTask] Successfully saved task %s.", taskID) // Added log

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
		task.Output = append(task.Output, message)
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
