package a2a

import (
	"encoding/json" // Manually added back
	"errors"        // Manually added back
	"fmt"
	"log"
	"regexp" // Import regexp for finding tool tags
	"sync"
	"time"
)

var ErrTaskNotFound = errors.New("task not found")

type TaskState string

const (
	TaskStateSubmitted     TaskState = "SUBMITTED"      // Changed to uppercase
	TaskStateWorking       TaskState = "WORKING"        // Changed to uppercase
	TaskStateInputRequired TaskState = "INPUT_REQUIRED" // Changed to uppercase
	TaskStateCompleted     TaskState = "COMPLETED"      // Changed to uppercase
	TaskStateFailed        TaskState = "FAILED"         // Changed to uppercase
	TaskStateCanceled      TaskState = "CANCELED"       // Changed to uppercase
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
	Type       string `json:"type"`
	MimeType   string `json:"mime_type"`
	URI        string `json:"uri,omitempty"`         // URI might be optional if ArtifactID is provided
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
	// RawToolCallsXML stores the raw XML string containing tool calls extracted from the LLM response.
	// It now stores the full LLM response string which might contain multiple <tool> tags.
	RawToolCallsXML string `json:"-"` // Ignore this field during standard JSON marshalling
	// ParsedToolCalls is populated after parsing RawToolCallsXML.
	ParsedToolCalls []ToolCall `json:"-"` // Ignore this field during standard JSON marshalling
	// ToolCallID is used in a tool message to indicate which tool call this message is a response to.
	ToolCallID string    `json:"tool_call_id,omitempty"`
	Timestamp  time.Time `json:"timestamp"` // Add timestamp to message
}

// ToolCall represents a single tool call parsed from the simplified XML structure.
type ToolCall struct {
	ID       string // Tool call ID from XML attribute
	Type     string // Tool type (hardcoded to "function" for now)
	Function FunctionCall
}

// FunctionCall represents the details of a function tool call parsed from XML.
type FunctionCall struct {
	Name      string // Function name from the tool id attribute
	Arguments string // Arguments as a string from the content between tags
}

// MarshalJSON implements the json.Marshaler interface for Message.
// This handles the serialization of the Part interface slice correctly.
func (m Message) MarshalJSON() ([]byte, error) {
	type MessageAlias Message
	tmp := struct {
		MessageAlias
		Parts []interface{} `json:"parts"`
	}{
		MessageAlias: MessageAlias(m),
		Parts:        make([]interface{}, len(m.Parts)),
	}

	for i, part := range m.Parts {
		tmp.Parts[i] = part
	}

	return json.Marshal(tmp)
}

// UnmarshalJSON implements the json.Unmarshaler interface for Message.
// This handles the deserialization of the Part interface slice.
// XML tool call parsing will happen separately after the full LLM response is received.
func (m *Message) UnmarshalJSON(data []byte) error {
	type MessageAlias Message

	tmp := struct {
		MessageAlias
		Parts      []json.RawMessage `json:"parts"`
		ToolCallID string            `json:"tool_call_id,omitempty"`
	}{}

	if err := json.Unmarshal(data, &tmp); err != nil {
		return fmt.Errorf("failed to unmarshal message base structure: %w", err)
	}

	m.Role = tmp.Role
	m.Parts = make([]Part, 0, len(tmp.Parts))
	m.ToolCallID = tmp.ToolCallID
	// RawToolCallsXML and ParsedToolCalls are not unmarshalled from the standard JSON message

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

	// If this is an assistant message, populate RawToolCallsXML from its TextPart(s)
	// and then attempt to parse tool calls. This ensures that when a task is loaded,
	// any tool calls embedded in assistant messages are readily available in ParsedToolCalls.
	if m.Role == RoleAssistant {
		// Populate m.RawToolCallsXML from the first TextPart found.
		// HandleLLMExecution currently puts the full LLM response (which contains tool XML)
		// into a single TextPart.
		for _, part := range m.Parts {
			if textPart, ok := part.(TextPart); ok {
				m.RawToolCallsXML = textPart.Text
				break // Found the first TextPart, assume it contains the raw XML.
			}
		}

		if m.RawToolCallsXML != "" {
			// Log the attempt to parse, similar to how ParseToolCallsFromXML does.
			// log.Printf("Message UnmarshalJSON: Assistant message with RawToolCallsXML found, attempting to parse from TextPart: %s", m.RawToolCallsXML)
			// No need to log here, ParseToolCallsFromXML already logs extensively.
			if err := m.ParseToolCallsFromXML(); err != nil {
				// Log error but don't fail unmarshalling, as ParseToolCallsFromXML itself handles logging.
				log.Printf("Message UnmarshalJSON: Error during ParseToolCallsFromXML (called from UnmarshalJSON): %v", err)
			}
		}
	}

	return nil
}

// Regex to find the <tool> XML block(s), handling escaped characters and optional whitespace.
// This regex captures the tool name in group 1 and the arguments in group 2.
// It looks for escaped characters \u003c (\u003e) for < (>) and \" for ".
// It is also more flexible with quotes around the ID and whitespace.
var parseToolCallRegex = regexp.MustCompile(`(?s)<tool\s+id="([^"]+?)">(.*?)</tool>`)

// ParseToolCallsFromXML attempts to find and parse tool calls from the RawToolCallsXML field
// using the simplified <tool id="tool_name">{json_arguments}</tool> structure,
// handling potentially escaped XML characters and surrounding whitespace.
func (m *Message) ParseToolCallsFromXML() error {
	log.Printf("Parsing tool calls from raw XML: %s", m.RawToolCallsXML) // Add logging here

	if m.Role != RoleAssistant || m.RawToolCallsXML == "" {
		m.ParsedToolCalls = nil // Ensure it's nil if not an assistant message or no XML
		return nil
	}

	// Find all matches of the simplified tool tag, using the regex that handles escaped characters
	matches := parseToolCallRegex.FindAllStringSubmatch(m.RawToolCallsXML, -1)

	if len(matches) == 0 {
		m.ParsedToolCalls = nil // Ensure it's nil if no matches are found
		log.Printf("No simplified <tool> tags (escaped with optional whitespace) found in LLM response.")
		// Also try the unescaped regex as a fallback, in case the LLM doesn't escape
		unescapedMatches := regexp.MustCompile(`(?s)\s*<tool\s+id="([^"]+?)"\s*>(.*?)\s*</tool>\s*`).FindAllStringSubmatch(m.RawToolCallsXML, -1)
		if len(unescapedMatches) > 0 {
			log.Printf("Found %d unescaped <tool> tags (with optional whitespace).", len(unescapedMatches))
			matches = unescapedMatches // Use unescaped matches if found
		} else {
			log.Printf("No unescaped <tool> tags (with optional whitespace) found either.")
			return nil // No tool calls found at all
		}
	} else {
		log.Printf("Found %d escaped <tool> tags (with optional whitespace).", len(matches))
	}

	m.ParsedToolCalls = make([]ToolCall, 0, len(matches))
	for _, match := range matches {
		if len(match) == 3 {
			toolID := match[1]    // Captured group 1: tool name from id attribute
			arguments := match[2] // Captured group 2: content between tags (JSON arguments)

			// Create a new ToolCall struct
			toolCall := ToolCall{
				// Generate a unique ID for this tool call instance if needed, or use toolID
				// For simplicity, let's use a combination of task message timestamp and toolID
				// A more robust approach might involve a counter or UUID.
				// Let's use a simple counter for uniqueness within this message.
				ID:   fmt.Sprintf("%s-%d", toolID, len(m.ParsedToolCalls)), // Simple unique ID
				Type: "function",                                           // Hardcoded type as per the new structure
				Function: FunctionCall{
					Name:      toolID,    // Tool name is the id attribute
					Arguments: arguments, // Arguments are the content
				},
			}
			m.ParsedToolCalls = append(m.ParsedToolCalls, toolCall)
			log.Printf("Parsed tool call: ID=%s, Name=%s, Arguments=%s", toolCall.ID, toolCall.Function.Name, toolCall.Function.Arguments)
		} else {
			log.Printf("Warning: Regex match did not capture expected groups. Match: %v", match)
		}
	}

	log.Printf("Successfully parsed %d tool calls from LLM response.", len(m.ParsedToolCalls))
	return nil
}

type Artifact struct {
	ID       string `json:"id"`
	Type     string `json:"type"`
	Filename string `json:"filename,omitempty"`
	Data     []byte `json:"data,omitempty"`
}

type Task struct {
	ID           string               `json:"id"`
	Name         string               `json:"name,omitempty"` // Added Name field for task list display
	State        TaskState            `json:"state"`
	SystemPrompt string               `json:"system_prompt,omitempty"` // Added SystemPrompt field
	Messages     []Message            `json:"messages,omitempty"`      // Replace Input/Output with a single Messages array
	Error        string               `json:"error,omitempty"`
	CreatedAt    time.Time            `json:"created_at"`
	UpdatedAt    time.Time            `json:"updated_at"`
	Artifacts    map[string]*Artifact `json:"artifacts,omitempty"`
}

type InMemoryTaskStore struct {
	mu    sync.RWMutex
	tasks map[string]*Task
}

func NewInMemoryTaskStore() *InMemoryTaskStore {
	return &InMemoryTaskStore{tasks: make(map[string]*Task)}
}

// CreateTask creates a new task with the given name, system prompt, and input messages.
func (s *InMemoryTaskStore) CreateTask(name string, systemPrompt string, inputMessages []Message) (*Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := fmt.Sprintf("task-%s", time.Now().Format(time.RFC3339Nano))
	now := time.Now()

	// Initialize messages with timestamps for InMemoryTaskStore
	messagesWithTimestamps := make([]Message, len(inputMessages))
	// 'now' is already declared above, use '=' for assignment
	now = time.Now()
	for i, msg := range inputMessages {
		msg.Timestamp = now // Add timestamp to initial messages
		messagesWithTimestamps[i] = msg
	}

	task := &Task{
		ID:           id,
		Name:         name, // Set the task name
		State:        TaskStateSubmitted,
		SystemPrompt: systemPrompt,           // Store the provided system prompt
		Messages:     messagesWithTimestamps, // Use the new Messages field
		CreatedAt:    now,
		UpdatedAt:    now,
		Artifacts:    make(map[string]*Artifact),
	}
	s.tasks[id] = task
	fmt.Printf("[TaskStore] Created Task: %s (Name: %s)\n", id, name)
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
		message.Timestamp = time.Now()                 // Add timestamp when message is added
		task.Messages = append(task.Messages, message) // Append to the single Messages array
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
	defer s.mu.Unlock()

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
	CreateTask(name string, systemPrompt string, inputMessages []Message) (*Task, error) // Updated signature to include name
	GetTask(taskID string) (*Task, error)
	UpdateTask(taskID string, updateFn func(*Task) error) (*Task, error)
	SetState(taskID string, state TaskState) error
	AddMessage(taskID string, message Message) error
	AddArtifact(taskID string, artifact Artifact) error
	GetArtifactData(taskID string, artifactID string) ([]byte, *Artifact, error)
	ListTasks() ([]*Task, error)
	DeleteTask(taskID string) error
}
