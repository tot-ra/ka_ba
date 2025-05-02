//go:build e2e

package a2a

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	testServerPort = 8899
	testServerURL  = "http://localhost:8899"
	testBinaryName = "test_ka_agent" // Use a distinct name for the test binary
)

// --- JSON-RPC Structures (copied for convenience) ---
type jsonRPCRequest struct {
	JSONRPC string      `json:"jsonrpc"`
	Method  string      `json:"method"`
	Params  interface{} `json:"params"`
	ID      interface{} `json:"id"`
}

type jsonRPCResponse struct {
	JSONRPC string        `json:"jsonrpc"`
	Result  interface{}   `json:"result,omitempty"`
	Error   *jsonRPCError `json:"error,omitempty"`
	ID      interface{}   `json:"id"`
}

type jsonRPCError struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// --- Test Setup (TestMain) ---

func TestMain(m *testing.M) {
	// Find the root 'ka' directory
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		fmt.Println("Error: Could not get caller information")
		os.Exit(1)
	}
	kaDir := filepath.Dir(filepath.Dir(filename)) // Go up two levels from ka/a2a/http_e2e_test.go to ka/
	testBinaryPath := filepath.Join(kaDir, testBinaryName)
	tasksDir := filepath.Join(kaDir, "_tasks") // Default tasks directory

	// *** ADDED: Preemptive kill of process on test port ***
	fmt.Printf("Attempting to kill any process listening on port %d...\n", testServerPort)
	// Use sh -c to handle potential errors if lsof finds nothing
	killCmd := exec.Command("sh", "-c", fmt.Sprintf("lsof -ti :%d | xargs kill -9", testServerPort))
	killOutput, killErr := killCmd.CombinedOutput()
	if killErr != nil {
		// Log error but continue, as it might just mean no process was running
		fmt.Printf("Kill command finished (might be expected error if no process was found): %v\nOutput: %s\n", killErr, string(killOutput))
	} else {
		fmt.Println("Kill command executed successfully (process likely found and killed).")
		time.Sleep(500 * time.Millisecond) // Give OS a moment to release the port
	}
	// *****************************************************

	// 1. Build the test binary
	fmt.Println("Building test agent binary...")
	buildCmd := exec.Command("go", "build", "-o", testBinaryPath, ".")
	buildCmd.Dir = kaDir // Run build command from the 'ka' directory
	buildOutput, err := buildCmd.CombinedOutput()
	if err != nil {
		fmt.Printf("Error building test binary: %v\nOutput:\n%s\n", err, string(buildOutput))
		os.Exit(1)
	}
	fmt.Println("Test agent binary built successfully.")

	// Cleanup function to remove binary and task data
	cleanup := func() {
		fmt.Println("Cleaning up test binary and task data...")
		os.Remove(testBinaryPath)
		os.RemoveAll(tasksDir) // Remove the tasks directory created by the agent
		fmt.Println("Cleanup complete.")
	}
	// Ensure cleanup runs even on panic or early exit
	defer cleanup()

	// 2. Start the server in the background
	fmt.Printf("Starting test agent server on port %d...\n", testServerPort)
	// Run without auth: pass empty strings for jwt/api keys if flags exist, or rely on defaults
	// Assuming the agent uses flags like -port, -jwt-secret, -api-keys
	// Adjust command based on actual flags/env vars used by ka/main.go
	// ADDED the -serve flag
	serverCmd := exec.Command(testBinaryPath, fmt.Sprintf("-port=%d", testServerPort), "-serve")
	serverCmd.Dir = kaDir // Run the server from the 'ka' directory
	// Redirect server output to a file instead of test output
	serverLogPath := filepath.Join(kaDir, "test_server.log")
	serverLogFile, err := os.Create(serverLogPath)
	if err != nil {
		fmt.Printf("Error creating server log file: %v\n", err)
		cleanup()
		os.Exit(1)
	}
	defer serverLogFile.Close()
	serverCmd.Stdout = serverLogFile
	serverCmd.Stderr = serverLogFile
	// Add server log file to cleanup
	defer os.Remove(serverLogPath)

	err = serverCmd.Start()
	if err != nil {
		fmt.Printf("Error starting test server: %v\n", err)
		cleanup() // Run cleanup before exiting
		os.Exit(1)
	}

	// Ensure server process is killed on exit
	defer func() {
		fmt.Println("Stopping test agent server...")
		if serverCmd.Process != nil {
			// Attempt graceful shutdown first
			if err := serverCmd.Process.Signal(os.Interrupt); err != nil {
				fmt.Printf("Error sending interrupt signal to server process: %v. Attempting kill...\n", err)
				// If interrupt fails, force kill
				if killErr := serverCmd.Process.Kill(); killErr != nil {
					fmt.Printf("Error killing server process: %v\n", killErr)
				}
			}
			// Wait for the process to exit after signal/kill
			_, waitErr := serverCmd.Process.Wait()
			if waitErr != nil {
				// Log wait error, but don't necessarily fail the cleanup
				// It might error if the process was already gone or killed forcefully
				fmt.Printf("Error waiting for server process to exit: %v\n", waitErr)
			}
		}
		fmt.Println("Test agent server stopped.")
	}()

	// 3. Wait for the server to be ready (poll health check)
	healthURL := fmt.Sprintf("%s/health", testServerURL)
	fmt.Printf("Waiting for server at %s...\n", healthURL)
	startTime := time.Now()
	maxWait := 30 * time.Second // Increased timeout
	ready := false
	for time.Since(startTime) < maxWait {
		resp, err := http.Get(healthURL)
		if err == nil && resp.StatusCode == http.StatusOK {
			resp.Body.Close()
			fmt.Println("Server is ready.")
			ready = true
			break
		}
		if err != nil {
			// fmt.Printf("Health check error: %v\n", err) // Can be noisy
		} else {
			resp.Body.Close()
			// fmt.Printf("Health check status: %d\n", resp.StatusCode) // Can be noisy
		}
		time.Sleep(500 * time.Millisecond) // Poll interval
	}

	if !ready {
		fmt.Println("Error: Server did not become ready within timeout.")
		// Attempt to capture server logs if possible (might require redirecting output to a file)
		cleanup() // Run cleanup before exiting
		os.Exit(1)
	}

	// 4. Run the actual tests
	exitCode := m.Run()

	// 5. Cleanup happens via defer statements

	os.Exit(exitCode)
}

// --- Helper Functions ---

// sendJSONRPCRequest sends a JSON-RPC request to the test server with added logging.
func sendJSONRPCRequest(t *testing.T, method string, params interface{}, id interface{}) (*jsonRPCResponse, *http.Response, error) {
	t.Helper()
	logPrefix := fmt.Sprintf("[TestClient %s %s]", id, method) // Log prefix for clarity
	t.Logf("%s: Preparing request...", logPrefix)
	reqBody := jsonRPCRequest{
		JSONRPC: "2.0",
		Method:  method,
		Params:  params,
		ID:      id,
	}
	reqBytes, err := json.Marshal(reqBody)
	require.NoError(t, err, "%s: Failed to marshal JSON-RPC request", logPrefix)
	t.Logf("%s: Marshalled request: %s", logPrefix, string(reqBytes))

	t.Logf("%s: Sending POST request to %s...", logPrefix, testServerURL+"/")
	resp, err := http.Post(testServerURL+"/", "application/json", bytes.NewBuffer(reqBytes))
	if err != nil {
		t.Logf("%s: HTTP POST request failed: %v", logPrefix, err)
		// Return raw error if HTTP request itself failed
		return nil, resp, fmt.Errorf("%s: HTTP POST request failed: %w", logPrefix, err)
	}
	t.Logf("%s: Received response status: %s", logPrefix, resp.Status)

	t.Logf("%s: Reading response body...", logPrefix)
	respBodyBytes, readErr := io.ReadAll(resp.Body)
	resp.Body.Close() // Close body immediately after reading
	if readErr != nil {
		t.Logf("%s: Failed to read response body: %v", logPrefix, readErr)
	}
	require.NoError(t, readErr, "%s: Failed to read response body", logPrefix)
	t.Logf("%s: Read response body (%d bytes): %s", logPrefix, len(respBodyBytes), string(respBodyBytes))

	if resp.StatusCode != http.StatusOK {
		t.Logf("%s: Unexpected HTTP status: %d", logPrefix, resp.StatusCode)
		// Return HTTP error details if status is not 200 OK
		return nil, resp, fmt.Errorf("%s: unexpected HTTP status: %d, body: %s", logPrefix, resp.StatusCode, string(respBodyBytes))
	}

	t.Logf("%s: Unmarshalling JSON response...", logPrefix)
	var jsonResp jsonRPCResponse
	err = json.Unmarshal(respBodyBytes, &jsonResp)
	if err != nil {
		t.Logf("%s: Failed to unmarshal JSON response: %v", logPrefix, err)
	}
	require.NoError(t, err, "%s: Failed to unmarshal JSON-RPC response body: %s", logPrefix, string(respBodyBytes))
	t.Logf("%s: Unmarshalled JSON response successfully.", logPrefix)

	return &jsonResp, resp, nil
}

// --- Test Cases ---

func TestE2ETaskList_NoTasks(t *testing.T) {
	// Test listing when no tasks have been created yet
	jsonResp, httpResp, err := sendJSONRPCRequest(t, "tasks/list", nil, "list-no-tasks-1")

	require.NoError(t, err, "tasks/list request failed")
	require.NotNil(t, jsonResp, "JSON response should not be nil on success")
	assert.Equal(t, http.StatusOK, httpResp.StatusCode)
	assert.Equal(t, "2.0", jsonResp.JSONRPC)
	assert.Equal(t, "list-no-tasks-1", jsonResp.ID)
	assert.Nil(t, jsonResp.Error, "JSON-RPC error should be nil")

	// Expect an empty list or nil result
	if jsonResp.Result == nil {
		// nil result is acceptable for an empty list
	} else {
		resultList, ok := jsonResp.Result.([]interface{})
		require.True(t, ok, "Result should be a list (or nil)")
		assert.Empty(t, resultList, "Task list should be empty")
	}
}

func TestE2ETaskList_WithTasks(t *testing.T) {
	// 1. Create a task first with the correct 'message' parameter structure
	sendParams := map[string]interface{}{
		"message": map[string]interface{}{ // Single message object, not 'input' array
			"role": "user",
			"parts": []map[string]interface{}{ // Array of parts
					{
						"type": "text",
						"text": "Test task for listing",
					},
				},
			},
	}
		// Add other required params for tasks/send if any (e.g., artifacts, sessionId)
	sendResp, httpRespSend, errSend := sendJSONRPCRequest(t, "tasks/send", sendParams, "send-for-list-1")

	// Assertions remain the same, but now expect success
	require.NoError(t, errSend, "tasks/send request failed")
	require.NotNil(t, sendResp, "tasks/send JSON response should not be nil")
	assert.Equal(t, http.StatusOK, httpRespSend.StatusCode)
	assert.Nil(t, sendResp.Error, "tasks/send JSON-RPC error should be nil")
	require.NotNil(t, sendResp.Result, "tasks/send result should not be nil")

	// Extract task ID from the send response (using the correct key "id")
	resultMap, ok := sendResp.Result.(map[string]interface{})
	require.True(t, ok, "tasks/send result should be a map, got: %+v", sendResp.Result)
	taskID, ok := resultMap["id"].(string) // Changed key from "task_id" to "id"
	require.True(t, ok, "tasks/send result map should contain a string 'id', got: %+v", resultMap)
	require.NotEmpty(t, taskID, "Task ID should not be empty")

	// Allow some time for the task to be potentially processed or stored
	time.Sleep(100 * time.Millisecond)

	// 2. List tasks
	listResp, httpRespList, errList := sendJSONRPCRequest(t, "tasks/list", nil, "list-with-tasks-1")

	require.NoError(t, errList, "tasks/list request failed")
	require.NotNil(t, listResp, "tasks/list JSON response should not be nil")
	assert.Equal(t, http.StatusOK, httpRespList.StatusCode)
	assert.Equal(t, "2.0", listResp.JSONRPC)
	assert.Equal(t, "list-with-tasks-1", listResp.ID)
	assert.Nil(t, listResp.Error, "tasks/list JSON-RPC error should be nil")
	require.NotNil(t, listResp.Result, "tasks/list result should not be nil")

	// 3. Assert the result contains the created task
	resultList, ok := listResp.Result.([]interface{})
	require.True(t, ok, "tasks/list result should be a list")
	assert.NotEmpty(t, resultList, "Task list should not be empty")

	// Find the task we created
	found := false
	for _, item := range resultList {
		taskMap, ok := item.(map[string]interface{})
		require.True(t, ok, "Each item in the list should be a map (task object)")
		if id, ok := taskMap["task_id"].(string); ok && id == taskID {
			found = true
			// Optionally assert other fields of the task if needed
			// Note: Comparing complex input directly might be brittle. Check key fields.
			// The listed task object might have different field names than the send response.
			// Let's check the actual listed task structure. Assuming it uses "id" as well.
			assert.Contains(t, taskMap, "id", "Listed task should have 'id' field") // Check for "id" instead of "task_id"
			assert.Contains(t, taskMap, "input", "Listed task should have 'input' field")
			assert.Contains(t, taskMap, "state", "Listed task should have 'state' field")
			// Check status, created_at, etc. if relevant
			break
		} else if id, ok := taskMap["id"].(string); ok && id == taskID { // Check using "id" key
			found = true
			assert.Contains(t, taskMap, "input", "Listed task should have 'input' field")
			assert.Contains(t, taskMap, "state", "Listed task should have 'state' field")
			break
		}
	}
	assert.True(t, found, "Created task with ID %s not found in the list", taskID)

	// TODO: Add more tests:
	// - Listing with multiple tasks
	// - Listing with pagination/filtering parameters (if supported by the agent)
	// - Listing after task completion/failure (check status)
}

// Add more E2E tests for other methods if needed
