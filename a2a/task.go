package a2a

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"
)

var ErrTaskNotFound = errors.New("task not found")

type TaskState string

const (
	TaskStateSubmitted     TaskState = "submitted"
	TaskStateWorking       TaskState = "working"
	TaskStateInputRequired TaskState = "input-required"
	TaskStateCompleted     TaskState = "completed"
	TaskStateFailed        TaskState = "failed"
	TaskStateCanceled      TaskState = "canceled"
)


type MessageRole string

const (
	RoleSystem    MessageRole = "system"
	RoleUser      MessageRole = "user"
	RoleAssistant MessageRole = "assistant"
	RoleTool      MessageRole = "tool"
)


type Part interface {
	GetType() string
}


type TextPart struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

func (tp TextPart) GetType() string { return "text" }


type FilePart struct {
	Type     string `json:"type"`
	MimeType   string `json:"mime_type"`
	URI        string `json:"uri,omitempty"` // URI might be optional if ArtifactID is provided
	ArtifactID string `json:"artifact_id,omitempty"` // Reference to an existing artifact
}

func (fp FilePart) GetType() string { return "file" }


type DataPart struct {
	Type     string `json:"type"`
	MimeType string `json:"mime_type"`
	Data     any    `json:"data"`
}

func (dp DataPart) GetType() string { return "data" }


type Message struct {
	Role  MessageRole `json:"role"`
	Parts []Part      `json:"parts"`

}


func (m *Message) UnmarshalJSON(data []byte) error {

	type MessageAlias Message

	tmp := struct {
		MessageAlias
		Parts []json.RawMessage `json:"parts"`
	}{}


	if err := json.Unmarshal(data, &tmp); err != nil {
		return fmt.Errorf("failed to unmarshal message base structure: %w", err)
	}


	*m = Message(tmp.MessageAlias)
	m.Parts = make([]Part, 0, len(tmp.Parts))


	for i, rawPart := range tmp.Parts {

		var typeMap map[string]interface{}
		if err := json.Unmarshal(rawPart, &typeMap); err != nil {
			log.Printf("Warning: Failed to unmarshal part %d into type map: %v. Raw: %s", i, err, string(rawPart))
			continue
		}

		partType, ok := typeMap["type"].(string)
		if !ok {
			log.Printf("Warning: Part %d missing or invalid 'type' field. Raw: %s", i, string(rawPart))
			continue
		}


		var part Part
		var err error
		switch partType {
		case "text":
			var textPart TextPart
			err = json.Unmarshal(rawPart, &textPart)
			part = textPart
		case "file":
			var filePart FilePart
			err = json.Unmarshal(rawPart, &filePart)
			part = filePart
		case "data":
			var dataPart DataPart
			err = json.Unmarshal(rawPart, &dataPart)
			part = dataPart
		default:
			log.Printf("Warning: Unrecognized part type '%s' for part %d. Raw: %s", partType, i, string(rawPart))
			continue
		}

		if err != nil {
			log.Printf("Warning: Failed to unmarshal part %d (type: %s): %v. Raw: %s", i, partType, err, string(rawPart))
			continue
		}

		m.Parts = append(m.Parts, part)
	}

	return nil
}




type Artifact struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Filename string `json:"filename,omitempty"`
	Data     []byte `json:"data,omitempty"`

}


type Task struct {
	ID        string               `json:"id"`
	State     TaskState            `json:"state"`
	Input     []Message            `json:"input,omitempty"`
	Output    []Message            `json:"output,omitempty"`
	Error     string               `json:"error,omitempty"`
	CreatedAt time.Time            `json:"created_at"`
	UpdatedAt time.Time            `json:"updated_at"`
	Artifacts map[string]*Artifact `json:"artifacts,omitempty"`
}


type InMemoryTaskStore struct {
	mu    sync.RWMutex
	tasks map[string]*Task
}


func NewInMemoryTaskStore() *InMemoryTaskStore {
	return &InMemoryTaskStore{tasks: make(map[string]*Task)}
}


func (s *InMemoryTaskStore) CreateTask(inputMessages []Message) (*Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()


	id := fmt.Sprintf("task-%s", time.Now().Format(time.RFC3339Nano))
	now := time.Now()

	task := &Task{
		ID:        id,
		State:     TaskStateSubmitted,
		Input:     inputMessages,
		CreatedAt: now,
		UpdatedAt: now,
		Artifacts: make(map[string]*Artifact),
	}
	s.tasks[id] = task
	fmt.Printf("[TaskStore] Created Task: %s\n", id)
	return task, nil
}


func (s *InMemoryTaskStore) GetTask(id string) (*Task, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.tasks[id]
	if !ok {
		return nil, ErrTaskNotFound
	}
	return t, nil
}


func (s *InMemoryTaskStore) SetState(taskID string, state TaskState) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if t, ok := s.tasks[taskID]; ok {
		t.State = state
		t.UpdatedAt = time.Now()
		fmt.Printf("[TaskStore] Updated Task State: %s, New State: %s\n", taskID, state)
		return nil
	}
	fmt.Printf("[TaskStore] SetState failed: Task %s not found\n", taskID)
	return ErrTaskNotFound
}


func (s *InMemoryTaskStore) UpdateTask(taskID string, updateFn func(*Task) error) (*Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	task, ok := s.tasks[taskID]
	if !ok {
		return nil, ErrTaskNotFound
	}


	err := updateFn(task)
	if err != nil {
		return nil, fmt.Errorf("update function failed for task %s: %w", taskID, err)
	}

	task.UpdatedAt = time.Now()

	fmt.Printf("[TaskStore] Updated Task: %s via UpdateTask\n", taskID)
	return task, nil
}


func (s *InMemoryTaskStore) AddMessage(taskID string, message Message) error {
	_, err := s.UpdateTask(taskID, func(task *Task) error {
		task.Output = append(task.Output, message)
		return nil
	})
	return err
}


func (s *InMemoryTaskStore) AddArtifact(taskID string, artifact Artifact) error {
	if artifact.ID == "" {
		artifact.ID = fmt.Sprintf("artifact-%d", time.Now().UnixNano())
	}
	_, err := s.UpdateTask(taskID, func(task *Task) error {
		if task.Artifacts == nil {
			task.Artifacts = make(map[string]*Artifact)
		}
		artCopy := artifact
		task.Artifacts[artCopy.ID] = &artCopy
		fmt.Printf("[TaskStore] Added/Updated Artifact %s to Task %s (Type: %s, Size: %d bytes)\n", artCopy.ID, taskID, artCopy.Type, len(artCopy.Data))
		return nil
	})
	return err
}


func (s *InMemoryTaskStore) GetArtifactData(taskID string, artifactID string) ([]byte, *Artifact, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	task, ok := s.tasks[taskID]
	if !ok {
		return nil, nil, fmt.Errorf("task %s not found", taskID)
	}

	artifact, ok := task.Artifacts[artifactID]
	if !ok {
		return nil, nil, fmt.Errorf("artifact %s not found in task %s", artifactID, taskID)
	}

	return artifact.Data, artifact, nil
}


func (s *InMemoryTaskStore) ListTasks() ([]*Task, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	taskList := make([]*Task, 0, len(s.tasks))
	for _, task := range s.tasks {
		taskList = append(taskList, task)
	}
	return taskList, nil
}


func (s *InMemoryTaskStore) DeleteTask(taskID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	if _, ok := s.tasks[taskID]; !ok {
		return ErrTaskNotFound
	}
	delete(s.tasks, taskID)
	fmt.Printf("[TaskStore] Deleted Task: %s\n", taskID)
	return nil
}



type TaskStore interface {
	CreateTask(inputMessages []Message) (*Task, error)
	GetTask(taskID string) (*Task, error)
	UpdateTask(taskID string, updateFn func(*Task) error) (*Task, error)
	SetState(taskID string, state TaskState) error
	AddMessage(taskID string, message Message) error
	AddArtifact(taskID string, artifact Artifact) error
	GetArtifactData(taskID string, artifactID string) ([]byte, *Artifact, error)
	ListTasks() ([]*Task, error)
	DeleteTask(taskID string) error
}
