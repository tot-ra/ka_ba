package a2a

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"
)

func setupTestDir(t *testing.T) string {
	t.Helper()
	tempDir, err := os.MkdirTemp("", "filetaskstore_test_*")
	if err != nil {
		t.Fatalf("Failed to create temp dir: %v", err)
	}

	t.Cleanup(func() { os.RemoveAll(tempDir) })
	return tempDir
}

func TestNewFileTaskStore(t *testing.T) {
	tempDir := setupTestDir(t)

	store, err := NewFileTaskStore(tempDir)
	if err != nil {
		t.Fatalf("NewFileTaskStore failed: %v", err)
	}
	if store == nil {
		t.Fatal("NewFileTaskStore returned nil store")
	}
	if store.baseDir != tempDir {
		t.Errorf("Expected baseDir %s, got %s", tempDir, store.baseDir)
	}

	defaultDir := filepath.Join(tempDir, "_tasks_default")
	storeDefault, err := NewFileTaskStore(defaultDir)
	if err != nil {
		t.Fatalf("NewFileTaskStore with default failed: %v", err)
	}
	if storeDefault == nil {
		t.Fatal("NewFileTaskStore with default returned nil store")
	}
	if storeDefault.baseDir != defaultDir {
		t.Errorf("Expected default baseDir %s, got %s", defaultDir, storeDefault.baseDir)
	}
	if _, err := os.Stat(defaultDir); os.IsNotExist(err) {
		t.Errorf("Default directory %s was not created", defaultDir)
	}
}

func TestFileTaskStore_CreateAndGetTask(t *testing.T) {
	tempDir := setupTestDir(t)
	store, err := NewFileTaskStore(tempDir)
	if err != nil {
		t.Fatalf("Setup failed: %v", err)
	}

	initialMsg := Message{Role: RoleUser, Parts: []Part{TextPart{Type: "text", Text: "Hello"}}}
	createdTask, err := store.CreateTask("test task", "test system prompt", []Message{initialMsg}, "")
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	if createdTask.ID == "" {
		t.Error("CreateTask did not assign an ID")
	}
	if createdTask.State != TaskStateSubmitted {
		t.Errorf("Expected initial state %s, got %s", TaskStateSubmitted, createdTask.State)
	}

	if len(createdTask.Messages) != 1 || len(createdTask.Messages[0].Parts) != 1 || createdTask.Messages[0].Parts[0].GetType() != "text" {
		t.Error("Initial message not set correctly")
	}

	// Check text content using type assertion
	textPart, ok := createdTask.Messages[0].Parts[0].(TextPart)
	if !ok {
		t.Error("Failed to convert part to TextPart")
	} else if textPart.Text != "Hello" {
		t.Errorf("Expected text 'Hello', got '%s'", textPart.Text)
	}

	filePath := store.taskFilePath(createdTask.ID)
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		t.Errorf("Task file %s was not created", filePath)
	}

	retrievedTask, err := store.GetTask(createdTask.ID)
	if err != nil {
		t.Fatalf("GetTask failed: %v", err)
	}

	if retrievedTask.ID != createdTask.ID {
		t.Errorf("Retrieved task ID mismatch: expected %s, got %s", createdTask.ID, retrievedTask.ID)
	}
	if retrievedTask.State != createdTask.State {
		t.Errorf("Retrieved task state mismatch: expected %s, got %s", createdTask.State, retrievedTask.State)
	}

	if len(retrievedTask.Messages) != 1 || len(retrievedTask.Messages[0].Parts) != 1 || retrievedTask.Messages[0].Parts[0].GetType() != "text" {
		t.Error("Retrieved message not correct")
	}

	// Check text content using type assertion
	textPart, ok = retrievedTask.Messages[0].Parts[0].(TextPart)
	if !ok {
		t.Error("Failed to convert retrieved part to TextPart")
	} else if textPart.Text != "Hello" {
		t.Errorf("Expected retrieved text 'Hello', got '%s'", textPart.Text)
	}

	_, err = store.GetTask("non-existent-id")
	if err != ErrTaskNotFound {
		t.Errorf("Expected ErrTaskNotFound for non-existent task, got %v", err)
	}
}

func TestFileTaskStore_UpdateTask(t *testing.T) {
	tempDir := setupTestDir(t)
	store, err := NewFileTaskStore(tempDir)
	if err != nil {
		t.Fatalf("Setup failed: %v", err)
	}

	initialMsg := Message{Role: RoleUser, Parts: []Part{TextPart{Type: "text", Text: "Initial"}}}
	task, err := store.CreateTask("test task", "test system prompt", []Message{initialMsg}, "")
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}
	originalTime := task.UpdatedAt

	time.Sleep(10 * time.Millisecond)

	updatedTask, err := store.UpdateTask(task.ID, func(t *Task) error {
		t.State = TaskStateWorking

		t.Messages = append(t.Messages, Message{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: "Working"}}})
		return nil
	})

	if err != nil {
		t.Fatalf("UpdateTask failed: %v", err)
	}
	if updatedTask.State != TaskStateWorking {
		t.Errorf("Expected state %s after update, got %s", TaskStateWorking, updatedTask.State)
	}
	if len(updatedTask.Messages) != 2 || updatedTask.Messages[1].Role != RoleAssistant {
		t.Errorf("Messages not updated correctly, expected 2, got %d", len(updatedTask.Messages))
	}
	if !updatedTask.UpdatedAt.After(originalTime) {
		t.Error("UpdatedAt timestamp was not updated")
	}

	retrievedTask, err := store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask after update failed: %v", err)
	}
	if retrievedTask.State != TaskStateWorking {
		t.Errorf("Persisted state incorrect: expected %s, got %s", TaskStateWorking, retrievedTask.State)
	}
	if len(retrievedTask.Messages) != 2 {
		t.Errorf("Persisted messages incorrect, expected 2, got %d", len(retrievedTask.Messages))
	}

	_, err = store.UpdateTask("non-existent-id", func(t *Task) error { return nil })
	if err != ErrTaskNotFound {
		t.Errorf("Expected ErrTaskNotFound for non-existent task update, got %v", err)
	}
}

func TestFileTaskStore_SetState(t *testing.T) {
	tempDir := setupTestDir(t)
	store, err := NewFileTaskStore(tempDir)
	if err != nil {
		t.Fatalf("Setup failed: %v", err)
	}

	task, err := store.CreateTask("test task", "test system prompt", []Message{{Role: RoleUser, Parts: []Part{&TextPart{Type: "text", Text: "Test"}}}}, "")
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	err = store.SetState(task.ID, TaskStateCompleted)
	if err != nil {
		t.Fatalf("SetState failed: %v", err)
	}

	retrievedTask, err := store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask after SetState failed: %v", err)
	}
	if retrievedTask.State != TaskStateCompleted {
		t.Errorf("Expected state %s after SetState, got %s", TaskStateCompleted, retrievedTask.State)
	}
}

func TestFileTaskStore_AddMessage(t *testing.T) {
	tempDir := setupTestDir(t)
	store, err := NewFileTaskStore(tempDir)
	if err != nil {
		t.Fatalf("Setup failed: %v", err)
	}

	task, err := store.CreateTask("test task", "test system prompt", []Message{{Role: RoleUser, Parts: []Part{TextPart{Type: "text", Text: "First"}}}}, "")
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	newMessage := Message{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: "Second"}}}
	err = store.AddMessage(task.ID, newMessage)
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}

	retrievedTask, err := store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask after AddMessage failed: %v", err)
	}

	if len(retrievedTask.Messages) != 2 {
		t.Fatalf("Expected 2 messages, got %d", len(retrievedTask.Messages))
	}

	// Check text content using type assertion
	textPart, ok := retrievedTask.Messages[1].Parts[0].(TextPart)
	if !ok {
		t.Error("Failed to convert part to TextPart")
	} else if retrievedTask.Messages[1].Role != RoleAssistant || textPart.Text != "Second" {
		t.Error("Message not added correctly")
	}
}

func TestFileTaskStore_AddArtifact(t *testing.T) {
	tempDir := setupTestDir(t)
	store, err := NewFileTaskStore(tempDir)
	if err != nil {
		t.Fatalf("Setup failed: %v", err)
	}

	task, err := store.CreateTask("test task", "test system prompt", []Message{{Role: RoleUser, Parts: []Part{&TextPart{Type: "text", Text: "Test"}}}}, "")
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	artifact1 := Artifact{ID: "art1", Type: "text/plain", Data: []byte("content1"), Filename: "file1.txt"}
	err = store.AddArtifact(task.ID, artifact1)
	if err != nil {
		t.Fatalf("AddArtifact 1 failed: %v", err)
	}

	artifact2 := Artifact{Type: "image/png", Filename: "image.png", Data: []byte{1, 2, 3}}
	err = store.AddArtifact(task.ID, artifact2)
	if err != nil {
		t.Fatalf("AddArtifact 2 failed: %v", err)
	}

	retrievedTask, err := store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask after AddArtifact failed: %v", err)
	}
	if len(retrievedTask.Artifacts) != 2 {
		t.Fatalf("Expected 2 artifacts, got %d", len(retrievedTask.Artifacts))
	}

	art1Ptr, ok := retrievedTask.Artifacts["art1"]
	if !ok {
		t.Error("Artifact 1 not found by ID")
	} else if string(art1Ptr.Data) != "content1" {
		t.Errorf("Artifact 1 data mismatch: expected 'content1', got '%s'", string(art1Ptr.Data))
	} else if art1Ptr.Filename != "file1.txt" {
		t.Errorf("Artifact 1 filename mismatch: expected 'file1.txt', got '%s'", art1Ptr.Filename)
	}

	foundArt2 := false
	for id, artPtr := range retrievedTask.Artifacts {
		if id != "art1" {

			if artPtr.Type != "image/png" || artPtr.Filename != "image.png" {
				t.Errorf("Artifact 2 mismatch: expected type image/png, filename image.png, got %+v", artPtr)
			}

			if len(artPtr.Data) != 3 || artPtr.Data[0] != 1 || artPtr.Data[1] != 2 || artPtr.Data[2] != 3 {
				t.Errorf("Artifact 2 data mismatch: expected [1 2 3], got %v", artPtr.Data)
			}
			if id == "" || !isValidUUID(id) {
				t.Errorf("Artifact 2 did not get a valid UUID assigned: %s", id)
			}
			foundArt2 = true
			break
		}
	}
	if !foundArt2 {
		t.Error("Artifact 2 not found")
	}
}

func isValidUUID(u string) bool {
	_, err := uuid.Parse(u)
	return err == nil
}

func TestFileTaskStore_GetArtifactData(t *testing.T) {
	tempDir := setupTestDir(t)
	store, err := NewFileTaskStore(tempDir)
	if err != nil {
		t.Fatalf("Setup failed: %v", err)
	}

	task, err := store.CreateTask("test task", "test system prompt", []Message{{Role: RoleUser, Parts: []Part{&TextPart{Type: "text", Text: "Test"}}}}, "")
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	artifactData := []byte("artifact content")
	artifact := Artifact{ID: "art1", Type: "text/plain", Data: artifactData, Filename: "data.txt"}
	err = store.AddArtifact(task.ID, artifact)
	if err != nil {
		t.Fatalf("AddArtifact failed: %v", err)
	}

	retrievedData, retrievedArtifact, err := store.GetArtifactData(task.ID, "art1")
	if err != nil {
		t.Fatalf("GetArtifactData failed: %v", err)
	}
	if retrievedArtifact == nil {
		t.Fatal("GetArtifactData returned nil artifact metadata")
	}

	if string(retrievedData) != string(artifactData) {
		t.Errorf("Retrieved artifact data mismatch: expected '%s', got '%s'", string(artifactData), string(retrievedData))
	}
	if retrievedArtifact.ID != "art1" {
		t.Errorf("Retrieved artifact ID mismatch: expected 'art1', got '%s'", retrievedArtifact.ID)
	}
	if retrievedArtifact.Type != "text/plain" {
		t.Errorf("Retrieved artifact type mismatch: expected 'text/plain', got '%s'", retrievedArtifact.Type)
	}
	if retrievedArtifact.Filename != "data.txt" {
		t.Errorf("Retrieved artifact filename mismatch: expected 'data.txt', got '%s'", retrievedArtifact.Filename)
	}

	_, _, err = store.GetArtifactData(task.ID, "non-existent-artifact")
	if err == nil {
		t.Error("Expected error for non-existent artifact ID, got nil")
	} else {

		expectedErrMsg := "artifact non-existent-artifact not found in task " + task.ID
		if err.Error() != expectedErrMsg {
			t.Errorf("Expected error message '%s', got '%s'", expectedErrMsg, err.Error())
		}
	}

	_, _, err = store.GetArtifactData("non-existent-task", "art1")
	if err != ErrTaskNotFound {
		t.Errorf("Expected ErrTaskNotFound for non-existent task ID, got %v", err)
	}
}
