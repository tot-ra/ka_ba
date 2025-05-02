package a2a

import (
	"bytes"
	"context"
	"encoding/json" // Ensure json is imported
	"errors"
	"fmt"
	"log"
	"strings"

	"ka/llm"
)

// handleLLMExecution calls the LLM, manages first-write state update, and handles results/errors.
func handleLLMExecution(
	ctx context.Context,
	taskID string,
	llmClient *llm.LLMClient,
	taskStore TaskStore,
	prompt string,
) (fullResultString string, inputTokens, completionTokens int, requiresInput bool, err error) {

	var fullOutputBuffer bytes.Buffer
	signaller := newFirstWriteSignaller(&fullOutputBuffer)
	stateUpdateCompleted := make(chan bool, 1)

	// Goroutine to set state to COMPLETED on first write
	go func() {
		select {
		case <-signaller.firstWriteCh:
			log.Printf("[Task %s] First write detected by signaller. Setting state to COMPLETED.", taskID)
			setStateErr := taskStore.SetState(taskID, TaskStateCompleted)
			if setStateErr != nil {
				log.Printf("[Task %s] Error setting state to COMPLETED after first write: %v", taskID, setStateErr)
				// Decide how to handle this - maybe log and continue?
			} else {
				log.Printf("[Task %s] State successfully set to COMPLETED.", taskID)
			}
			stateUpdateCompleted <- true // Signal that the update attempt finished
		case <-ctx.Done():
			log.Printf("[Task %s] Context cancelled before first write detected.", taskID)
			stateUpdateCompleted <- false // Signal that the update didn't happen
		}
	}()

	// Call LLM (Always Streaming Now)
	fullResultString, inputTokens, completionTokens, llmErr := llmClient.Chat(ctx, prompt, true, signaller)

	// Ensure the state update goroutine has finished before proceeding
	<-stateUpdateCompleted

	// Handle LLM Result
	if llmErr != nil {
		// Handle LLM errors (e.g., network, API errors, context cancellation during stream)
		finalState := TaskStateFailed
		errMsg := fmt.Sprintf("LLM stream failed: %v", llmErr)
		if errors.Is(llmErr, context.Canceled) || errors.Is(llmErr, context.DeadlineExceeded) {
			log.Printf("[Task %s] LLM stream cancelled or timed out: %v", taskID, llmErr)
			finalState = TaskStateCanceled
			errMsg = fmt.Sprintf("LLM stream cancelled or timed out: %v", llmErr)
		} else {
			log.Printf("[Task %s] LLM stream failed: %v. Input Tokens: %d", taskID, llmErr, inputTokens)
		}

		// Update task with error message
		_, updateErr := taskStore.UpdateTask(taskID, func(task *Task) error {
			task.Error = errMsg
			return nil
		})
		if updateErr != nil {
			log.Printf("[Task %s] Failed to update task with LLM error message: %v", taskID, updateErr)
		}

		// Set final state (Failed or Canceled)
		setStateErr := taskStore.SetState(taskID, finalState)
		if setStateErr != nil {
			log.Printf("[Task %s] Failed to set final task state to %s after LLM error: %v", taskID, finalState, setStateErr)
		}
		return "", inputTokens, completionTokens, false, llmErr // Return the original LLM error
	}

	// LLM Call Succeeded
	fmt.Printf("[Task %s] LLM Stream Success. Input Tokens: %d, Completion Tokens: %d\n", taskID, inputTokens, completionTokens)

	// Check if the full response requires input
	requiresInput = strings.Contains(fullResultString, "[INPUT_REQUIRED]")

	return fullResultString, inputTokens, completionTokens, requiresInput, nil
}

// handleLLMExecutionStream calls the LLM for streaming output directly to SSE.
func handleLLMExecutionStream(
	ctx context.Context,
	taskID string,
	llmClient *llm.LLMClient,
	taskStore TaskStore,
	prompt string,
	sseWriter *SSEWriter,
) (fullResultString string, inputTokens, completionTokens int, requiresInput bool, err error) {

	log.Printf("[Task %s Stream] Sending prompt to LLM for streaming...\n", taskID)
	fullResultString, inputTokens, completionTokens, llmErr := llmClient.Chat(ctx, prompt, true, sseWriter) // Pass context and sseWriter

	if llmErr != nil {
		fmt.Printf("[Task %s Stream] LLM Error. Input Tokens: %d\n", taskID, inputTokens) // Log input tokens even on error
		finalState := TaskStateFailed
		errMsg := llmErr.Error()
		if errors.Is(llmErr, context.Canceled) || errors.Is(llmErr, context.DeadlineExceeded) {
			log.Printf("[Task %s Stream] LLM stream cancelled or timed out (client likely disconnected): %v\n", taskID, llmErr)
			finalState = TaskStateCanceled
		} else {
			log.Printf("[Task %s Stream] LLM stream failed: %v\n", taskID, llmErr)
		}

		taskStore.UpdateTask(taskID, func(task *Task) error { task.Error = errMsg; return nil }) // Store the error
		setStateErr := taskStore.SetState(taskID, finalState)

		if setStateErr == nil && finalState == TaskStateFailed {
			failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": errMsg})
			sseWriter.SendEvent("state", string(failedStateData))
		} else if setStateErr != nil {
			log.Printf("[Task %s Stream] Failed to set final task state to %s after LLM error: %v\n", taskID, finalState, setStateErr)
		}
		return "", inputTokens, completionTokens, false, llmErr // Return original error
	}

	// Log token usage on success
	fmt.Printf("[Task %s Stream] LLM Success. Input Tokens: %d, Completion Tokens: %d\n", taskID, inputTokens, completionTokens)

	requiresInput = strings.Contains(fullResultString, "[INPUT_REQUIRED]")

	return fullResultString, inputTokens, completionTokens, requiresInput, nil
}
