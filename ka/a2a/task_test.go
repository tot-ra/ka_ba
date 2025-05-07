package a2a

import (
	"bytes" // Added for byte slice comparison
	"encoding/json"
	"fmt"
	"reflect" // For deep equality checks
	"strings" // Added for string prefix check
	"testing"
	"time"
)


func TestNewInMemoryTaskStore(t *testing.T) {
	store := NewInMemoryTaskStore()
	if store == nil {
		t.Fatal("NewInMemoryTaskStore returned nil")
	}
	if store.tasks == nil {
		t.Fatal("NewInMemoryTaskStore did not initialize the tasks map")
	}
	if len(store.tasks) != 0 {
		t.Errorf("Expected new task store to have 0 tasks, got %d", len(store.tasks))
	}
}

func TestMessageUnmarshalJSON(t *testing.T) {
	testCases := []struct {
		name        string
		jsonData    string
		expectedMsg Message
		expectError bool
	}{
		{
			name:     "Text Part Only",
			jsonData: `{"role": "user", "parts": [{"type": "text", "text": "Hello"}]}`,
			expectedMsg: Message{
				Role:  RoleUser,
				Parts: []Part{TextPart{Type: "text", Text: "Hello"}},
			},
			expectError: false,
		},
		{
			name:     "File Part Only",
			jsonData: `{"role": "assistant", "parts": [{"type": "file", "mime_type": "image/png", "uri": "file:///tmp/image.png"}]}`,
			expectedMsg: Message{
				Role:  RoleAssistant,
				Parts: []Part{FilePart{Type: "file", MimeType: "image/png", URI: "file:///tmp/image.png"}},
			},
			expectError: false,
		},
		{
			name:     "Data Part Only",
			jsonData: `{"role": "tool", "parts": [{"type": "data", "mime_type": "application/json", "data": {"key": "value"}}]}`,
			expectedMsg: Message{
				Role: RoleTool,
				Parts: []Part{DataPart{Type: "data", MimeType: "application/json", Data: map[string]interface{}{"key": "value"}}},
			},
			expectError: false,
		},
		{
			name: "Mixed Parts",
			jsonData: `{
				"role": "user",
				"parts": [
					{"type": "text", "text": "Analyze this:"},
					{"type": "file", "mime_type": "text/csv", "uri": "file:///data.csv"},
					{"type": "data", "mime_type": "application/json", "data": [1, 2, 3]}
				]
			}`,
			expectedMsg: Message{
				Role: RoleUser,
				Parts: []Part{
					TextPart{Type: "text", Text: "Analyze this:"},
					FilePart{Type: "file", MimeType: "text/csv", URI: "file:///data.csv"},
					DataPart{Type: "data", MimeType: "application/json", Data: []interface{}{float64(1), float64(2), float64(3)}}, // JSON numbers are float64 by default
				},
			},
			expectError: false,
		},
		{
			name:     "Empty Parts Array",
			jsonData: `{"role": "system", "parts": []}`,
			expectedMsg: Message{
				Role:  RoleSystem,
				Parts: []Part{},
			},
			expectError: false,
		},
		{
			name:     "Missing Parts Array",
			jsonData: `{"role": "system"}`,
			expectedMsg: Message{
				Role:  RoleSystem,
				Parts: nil, // Expect nil, not empty slice, if key is missing
			},
			expectError: false,
		},
		{
			name: "Invalid Part Type Skipped",
			jsonData: `{
				"role": "user",
				"parts": [
					{"type": "text", "text": "Valid"},
					{"type": "invalid", "foo": "bar"},
					{"type": "file", "mime_type": "text/plain", "uri": "file:///doc.txt"}
				]
			}`,
			expectedMsg: Message{
				Role: RoleUser,
				Parts: []Part{
					TextPart{Type: "text", Text: "Valid"},
					FilePart{Type: "file", MimeType: "text/plain", URI: "file:///doc.txt"},
				},
			},
			expectError: false, // Should not error, just skip invalid part
		},
		{
			name: "Part Missing Type Skipped",
			jsonData: `{
				"role": "user",
				"parts": [
					{"text": "No type here"},
					{"type": "text", "text": "Valid"}
				]
			}`,
			expectedMsg: Message{
				Role: RoleUser,
				Parts: []Part{
					TextPart{Type: "text", Text: "Valid"},
				},
			},
			expectError: false, // Should not error, just skip invalid part
		},
		{
			name: "Malformed Part Skipped (Unknown Type)", // Renamed for clarity
			jsonData: `{
				"role": "user",
				"parts": [
					{"type": "text", "text": "Valid"},
					{"type": "unknown_type", "some_data": 123}
				]
			}`, // Valid JSON, but unknown type part
			expectedMsg: Message{
				Role: RoleUser,
				Parts: []Part{
					TextPart{Type: "text", Text: "Valid"},
				},
			},
			expectError: false, // Should not error, just skip invalid part
		},
		{
			name:        "Malformed Message JSON",
			jsonData:    `{"role": "user", "parts": [`,
			expectedMsg: Message{},
			expectError: true,
		},
		{
			name:        "Malformed Base Message Structure",
			jsonData:    `{"role": 123, "parts": []}`, // Role is not a string
			expectedMsg: Message{},
			expectError: true,
		},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			var msg Message
			err := json.Unmarshal([]byte(tc.jsonData), &msg)

			if tc.expectError {
				if err == nil {
					t.Errorf("Expected an error, but got nil")
				}
			} else {
				if err != nil {
					t.Errorf("Unexpected error: %v", err)
				}

				if msg.Role != tc.expectedMsg.Role {
					t.Errorf("Role mismatch: expected %v, got %v", tc.expectedMsg.Role, msg.Role)
				}


				if len(msg.Parts) != len(tc.expectedMsg.Parts) {
					t.Fatalf("Parts count mismatch: expected %d, got %d. Got: %+v", len(tc.expectedMsg.Parts), len(msg.Parts), msg.Parts)
				}


				for i := range msg.Parts {
					expectedPart := tc.expectedMsg.Parts[i]
					actualPart := msg.Parts[i]


					if reflect.TypeOf(expectedPart) != reflect.TypeOf(actualPart) {
						t.Errorf("Part %d type mismatch: expected %T, got %T", i, expectedPart, actualPart)
						continue
					}


					if !reflect.DeepEqual(expectedPart, actualPart) {
						t.Errorf("Part %d content mismatch:\nExpected: %+v (%T)\nActual:   %+v (%T)", i, expectedPart, expectedPart, actualPart, actualPart)
					}
				}
			}
		})
	}
}


func TestInMemoryTaskStore_AddArtifact(t *testing.T) {
	store := NewInMemoryTaskStore()
	task, err := store.CreateTask("test system prompt", []Message{{Role: RoleUser, Parts: []Part{TextPart{Type: "text", Text: "Test"}}}})
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
		t.Error("Artifact 1 not found by ID 'art1'")
	} else if string(art1Ptr.Data) != "content1" {
		t.Errorf("Artifact 1 data mismatch: expected 'content1', got '%s'", string(art1Ptr.Data))
	} else if art1Ptr.Filename != "file1.txt" {
		t.Errorf("Artifact 1 filename mismatch: expected 'file1.txt', got '%s'", art1Ptr.Filename)
	} else if art1Ptr.Type != "text/plain" {
		t.Errorf("Artifact 1 type mismatch: expected 'text/plain', got '%s'", art1Ptr.Type)
	}


	foundArt2 := false
	var art2ID string
	for id, artPtr := range retrievedTask.Artifacts {
		if id != "art1" {
			art2ID = id
			if artPtr.Type != "image/png" || artPtr.Filename != "image.png" {
				t.Errorf("Artifact 2 mismatch: expected type image/png, filename image.png, got %+v", artPtr)
			}
			if !bytes.Equal(artPtr.Data, []byte{1, 2, 3}) {
				t.Errorf("Artifact 2 data mismatch: expected [1 2 3], got %v", artPtr.Data)
			}
			if id == "" {
				t.Error("Artifact 2 did not get an ID assigned")
			}

			if !strings.HasPrefix(id, "artifact-") {
				t.Logf("Warning: Generated artifact ID '%s' doesn't start with 'artifact-'", id)
			}
			foundArt2 = true
			break
		}
	}
	if !foundArt2 {
		t.Error("Artifact 2 (with generated ID) not found")
	}


	updatedArtifact1 := Artifact{ID: "art1", Type: "text/markdown", Data: []byte("updated content"), Filename: "file1.md"}
	err = store.AddArtifact(task.ID, updatedArtifact1)
	if err != nil {
		t.Fatalf("Update Artifact 1 failed: %v", err)
	}

	retrievedTask, err = store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask after updating artifact failed: %v", err)
	}
	if len(retrievedTask.Artifacts) != 2 {
		t.Fatalf("Expected 2 artifacts after update, got %d", len(retrievedTask.Artifacts))
	}
	art1PtrUpdated, ok := retrievedTask.Artifacts["art1"]
	if !ok {
		t.Error("Updated Artifact 1 not found by ID 'art1'")
	} else if string(art1PtrUpdated.Data) != "updated content" {
		t.Errorf("Updated Artifact 1 data mismatch: expected 'updated content', got '%s'", string(art1PtrUpdated.Data))
	} else if art1PtrUpdated.Filename != "file1.md" {
		t.Errorf("Updated Artifact 1 filename mismatch: expected 'file1.md', got '%s'", art1PtrUpdated.Filename)
	} else if art1PtrUpdated.Type != "text/markdown" {
		t.Errorf("Updated Artifact 1 type mismatch: expected 'text/markdown', got '%s'", art1PtrUpdated.Type)
	}


	art2Ptr, ok := retrievedTask.Artifacts[art2ID]
	if !ok {
		t.Errorf("Artifact 2 (ID: %s) not found after updating artifact 1", art2ID)
	} else if !bytes.Equal(art2Ptr.Data, []byte{1, 2, 3}) {
		t.Errorf("Artifact 2 data changed unexpectedly after updating artifact 1")
	}


	err = store.AddArtifact("non-existent-task", artifact1)
	if err != ErrTaskNotFound {
		t.Errorf("Expected ErrTaskNotFound when adding artifact to non-existent task, got %v", err)
	}
}

func TestInMemoryTaskStore_GetArtifactData(t *testing.T) {
	store := NewInMemoryTaskStore()
	task, err := store.CreateTask("test system prompt", []Message{{Role: RoleUser, Parts: []Part{TextPart{Type: "text", Text: "Test"}}}})
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
		t.Fatalf("GetArtifactData failed for existing artifact: %v", err)
	}
	if retrievedArtifact == nil {
		t.Fatal("GetArtifactData returned nil artifact metadata for existing artifact")
	}

	if !bytes.Equal(retrievedData, artifactData) {
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

	if !bytes.Equal(retrievedArtifact.Data, artifactData) {
		t.Errorf("Artifact metadata data field mismatch: expected '%s', got '%s'", string(artifactData), string(retrievedArtifact.Data))
	}



	_, _, err = store.GetArtifactData(task.ID, "non-existent-artifact")
	if err == nil {
		t.Error("Expected error when getting non-existent artifact, got nil")
	} else {
		expectedErrMsg := fmt.Sprintf("artifact non-existent-artifact not found in task %s", task.ID)
		if err.Error() != expectedErrMsg {
			t.Errorf("Expected error message '%s', got '%s'", expectedErrMsg, err.Error())
		}
	}


	_, _, err = store.GetArtifactData("non-existent-task", "art1")
	if err == nil {
		t.Error("Expected error when getting artifact from non-existent task, got nil")
	} else {
		expectedErrMsg := fmt.Sprintf("task non-existent-task not found")
		if err.Error() != expectedErrMsg {
			t.Errorf("Expected error message '%s', got '%s'", expectedErrMsg, err.Error())
		}
	}
}


func TestNewTask(t *testing.T) {
	store := NewInMemoryTaskStore()
	inputMessages := []Message{
		{Role: RoleUser, Parts: []Part{TextPart{Type: "text", Text: "Hello"}}},
	}
	task, err := store.CreateTask("test system prompt", inputMessages)
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}
	if task == nil {
		t.Fatal("NewTask returned nil")
	}
	if task.ID == "" {
		t.Error("NewTask did not assign an ID")
	}
	if task.State != TaskStateSubmitted {
		t.Errorf("Expected initial state %s, got %s", TaskStateSubmitted, task.State)
	}
	if !reflect.DeepEqual(task.Input, inputMessages) {
		t.Errorf("Expected input messages %+v, got %+v", inputMessages, task.Input)
	}
	if task.CreatedAt.IsZero() {
		t.Error("CreatedAt timestamp was not set")
	}
	if task.UpdatedAt.IsZero() {
		t.Error("UpdatedAt timestamp was not set")
	}
	if task.Artifacts == nil {
		t.Error("Artifacts map was not initialized")
	}


	retrievedTask, err := store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("CreateTask did not store the task correctly, GetTask failed: %v", err)
	}
	if retrievedTask != task {
		t.Errorf("Retrieved task pointer differs from the created task pointer")
	}
}

func TestGetTask(t *testing.T) {
	store := NewInMemoryTaskStore()
	task, err := store.CreateTask("test system prompt", []Message{{Role: RoleUser, Parts: []Part{TextPart{Type: "text", Text: "Test"}}}})
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}

	retrievedTask, err := store.GetTask(task.ID)
	if err != nil {
		t.Errorf("GetTask failed to retrieve existing task with ID %s: %v", task.ID, err)
	}
	if retrievedTask == nil {
		t.Errorf("Get returned ok=true but task is nil for ID %s", task.ID)
	}
	if retrievedTask != task {
		t.Errorf("Get retrieved a different task instance for ID %s", task.ID)
	}


	_, err = store.GetTask("non-existent-id")
	if err == nil {
		t.Error("GetTask returned ok=true for a non-existent task ID")
	}
}


func TestSetState(t *testing.T) {
	store := NewInMemoryTaskStore()
	task, err := store.CreateTask("test system prompt", []Message{{Role: RoleUser, Parts: []Part{TextPart{Type: "text", Text: "Test"}}}})
	if err != nil {
		t.Fatalf("CreateTask failed: %v", err)
	}
	initialTime := task.UpdatedAt

	time.Sleep(1 * time.Millisecond)


	err = store.SetState(task.ID, TaskStateWorking)
	if err != nil {
		t.Fatalf("SetState failed for task %s: %v", task.ID, err)
	}
	// Retrieve task to check state
	task, err = store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask failed after SetState: %v", err)
	}
	if task.State != TaskStateWorking {
		t.Errorf("Expected state %s, got %s", TaskStateWorking, task.State)
	}
	if !task.UpdatedAt.After(initialTime) {
		t.Errorf("UpdatedAt timestamp was not updated after SetState")
	}
	workingTime := task.UpdatedAt


	time.Sleep(1 * time.Millisecond)
	outputMessages := Message{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: "Done"}}}
	err = store.AddMessage(task.ID, outputMessages)
	if err != nil {
		t.Fatalf("AddMessage failed: %v", err)
	}
	err = store.SetState(task.ID, TaskStateCompleted)
	if err != nil {
		t.Fatalf("SetState to Completed failed: %v", err)
	}

	// Retrieve task to check state and output
	task, err = store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask failed after SetState: %v", err)
	}
	if task.State != TaskStateCompleted {
		t.Errorf("Expected state %s, got %s", TaskStateCompleted, task.State)
	}
	if len(task.Output) != 1 || !reflect.DeepEqual(task.Output[0], outputMessages) {
		t.Errorf("Expected output %+v, got %+v", []Message{outputMessages}, task.Output)
	}
	if !task.UpdatedAt.After(workingTime) {
		t.Errorf("UpdatedAt timestamp was not updated after SetState")
	}
	completedTime := task.UpdatedAt


	time.Sleep(1 * time.Millisecond)
	testError := fmt.Errorf("something went wrong")
	_, err = store.UpdateTask(task.ID, func(t *Task) error {
		t.Error = testError.Error()
		return nil
	})
	if err != nil {
		t.Fatalf("UpdateTask to set error failed: %v", err)
	}
	err = store.SetState(task.ID, TaskStateFailed)
	if err != nil {
		t.Fatalf("SetState to Failed failed: %v", err)
	}

	// Retrieve task to check state and error
	task, err = store.GetTask(task.ID)
	if err != nil {
		t.Fatalf("GetTask failed after SetState: %v", err)
	}
	if task.State != TaskStateFailed {
		t.Errorf("Expected state %s, got %s", TaskStateFailed, task.State)
	}
	if task.Error != testError.Error() {
		t.Errorf("Expected error '%s', got '%s'", testError.Error(), task.Error)
	}
	if !task.UpdatedAt.After(completedTime) {
		t.Errorf("UpdatedAt timestamp was not updated after SetState")
	}


	err = store.SetState("non-existent-id", TaskStateWorking)
	if err == nil {
		t.Error("SetState returned ok=true for a non-existent task ID")
	}
}
