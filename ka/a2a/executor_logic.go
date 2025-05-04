package a2a

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
)

// processTaskIteration handles a single iteration of the main loop for ExecuteTask.
// It returns true if the loop should continue (due to INPUT_REQUIRED or tool calls), false otherwise.
// It also returns any error encountered during the iteration that should stop the process.
func (te *TaskExecutor) processTaskIteration(ctx context.Context, t *Task, resumeCh chan struct{}) (continueLoop bool, err error) {
	currentTask, err := te.TaskStore.GetTask(t.ID)
	if err != nil {
		log.Printf("[Task %s] Error getting task from store during execution: %v", t.ID, err)
		return false, err // Stop processing if we can't get the task
	}
	if currentTask.State == TaskStateCanceled {
		log.Printf("[Task %s] Task was cancelled externally. Stopping.", t.ID)
		return false, nil // Not an error, but stop processing
	}

	// Build messages for the LLM using the helper function
	llmMessages, contentFound, extractErr := buildPromptFromInput(t.ID, currentTask.Input, te.SystemMessage)
	if extractErr != nil {
		te.TaskStore.UpdateTask(t.ID, func(task *Task) error {
			task.Error = extractErr.Error()
			return nil
		})
		te.TaskStore.SetState(t.ID, TaskStateFailed)
		fmt.Printf("[Task %s] Failed during message building: %v\n", t.ID, extractErr)
		return false, extractErr // Stop processing on message building error
	}
	if !contentFound {
		errMsg := "could not extract suitable content from messages for LLM"
		te.TaskStore.UpdateTask(t.ID, func(task *Task) error {
			task.Error = errMsg
			return nil
		})
		te.TaskStore.SetState(t.ID, TaskStateFailed)
		fmt.Printf("[Task %s] Failed: %s\n", t.ID, errMsg)
		return false, fmt.Errorf(errMsg) // Stop processing
	}

	// Log the messages being sent to the LLM
	logMessages := ""
	for i, msg := range llmMessages {
		if i > 0 {
			logMessages += "\n---\n"
		}
		logMessages += fmt.Sprintf("Role: %s\nContent: %s", msg.Role, msg.Content)
	}
	if len(logMessages) > 500 { // Truncate log output if too long
		logMessages = logMessages[:500] + "..."
	}
	fmt.Printf("[Task %s] Messages for LLM:\n---\n%s\n---\n", t.ID, logMessages)

	// Call the extracted LLM execution handler
	fullResultString, _, _, requiresInput, llmErr := handleLLMExecution(ctx, t.ID, te.LLMClient, te.TaskStore, llmMessages) // Pass messages slice

	// Handle LLM error returned by the handler
	if llmErr != nil {
		// Error logging and state setting is handled within handleLLMExecution
		return false, llmErr // Stop processing on LLM error
	}

	// After LLM execution, check the *latest* task state and output for tool calls
	updatedTask, err := te.TaskStore.GetTask(t.ID)
	if err != nil {
		log.Printf("[Task %s] Error getting task after LLM execution: %v", t.ID, err)
		return false, err // Stop processing
	}

	// Find the last message from the assistant (which should contain tool_calls if any)
	var lastAssistantMessage *Message
	for i := len(updatedTask.Output) - 1; i >= 0; i-- {
		if updatedTask.Output[i].Role == RoleAssistant {
			lastAssistantMessage = &updatedTask.Output[i]
			break
		}
	}

	if lastAssistantMessage != nil && len(lastAssistantMessage.ParsedToolCalls) > 0 {
		log.Printf("[Task %s] Detected %d tool calls in LLM response.", t.ID, len(lastAssistantMessage.ParsedToolCalls))

		toolDispatcher := NewToolDispatcher(te.TaskStore) // Create a new dispatcher instance

		toolResults := []Message{}
		for _, toolCall := range lastAssistantMessage.ParsedToolCalls {
			toolResultMsg, dispatchErr := toolDispatcher.DispatchToolCall(ctx, t.ID, toolCall)
			if dispatchErr != nil {
				// Log the dispatch error but continue processing other tool calls
				log.Printf("[Task %s] Error dispatching tool call %s (%s): %v", t.ID, toolCall.ID, toolCall.Function.Name, dispatchErr)
				// The DispatchToolCall function already includes an error message in the returned Message,
				// so we just append the message.
			}
			toolResults = append(toolResults, toolResultMsg)
		}

		// Append tool results to the task's input for the next LLM iteration
		_, updateErr := te.TaskStore.UpdateTask(t.ID, func(task *Task) error {
			task.Input = append(task.Input, toolResults...) // Append all tool result messages
			// Clear output after processing tool calls, as the next iteration starts with new input
			task.Output = []Message{}
			task.Error = "" // Clear any previous error
			return nil
		})
		if updateErr != nil {
			log.Printf("[Task %s] Failed to update task with tool results: %v", t.ID, updateErr)
			te.TaskStore.SetState(t.ID, TaskStateFailed) // Set state to failed if we can't update task
			return false, updateErr                      // Stop processing
		}

		log.Printf("[Task %s] Appended %d tool result messages to input. Continuing loop.", t.ID, len(toolResults))
		// Set state back to Working before the next iteration
		if err := te.TaskStore.SetState(t.ID, TaskStateWorking); err != nil {
			log.Printf("[Task %s] Failed to set state back to Working after tool calls: %v", t.ID, err)
			return false, err // Stop processing if we can't reset state
		}
		return true, nil // Continue the loop to send tool results to LLM

	} else if requiresInput {
		// Process the result based on whether input is required (if no tool calls were made)
		log.Printf("[Task %s] Input Required detected in full response (no tool calls).", t.ID)
		outputMessage := Message{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: fullResultString}}}

		_, updateErr := te.TaskStore.UpdateTask(t.ID, func(task *Task) error {
			task.Output = append(task.Output, outputMessage)
			task.Error = "" // Clear any previous error
			return nil
		})
		if updateErr != nil {
			log.Printf("[Task %s] Failed to update task with input required output: %v", t.ID, updateErr)
			// Consider setting state to failed here? For now, just log.
		}

		// Revert state to InputRequired
		setStateErr := te.TaskStore.SetState(t.ID, TaskStateInputRequired)
		if setStateErr != nil {
			log.Printf("[Task %s] Failed to revert task state to InputRequired: %v", t.ID, setStateErr)
			// If we can't set InputRequired, the task is stuck. Maybe set to Failed?
			te.TaskStore.SetState(t.ID, TaskStateFailed) // Attempt to set failed state
			return false, setStateErr                    // Stop processing
		}
		fmt.Printf("[Task %s] State set to InputRequired. Waiting for resume signal...\n", t.ID)

		// Wait for the resume signal or context cancellation
		select {
		case <-resumeCh:
			fmt.Printf("[Task %s] Resume signal received. Continuing loop.\n", t.ID)
			// Set state back to Working before the next iteration
			if err := te.TaskStore.SetState(t.ID, TaskStateWorking); err != nil {
				log.Printf("[Task %s] Failed to set state back to Working after resume: %v", t.ID, err)
				// Consider setting state to failed here?
				return false, err // Stop processing if we can't reset state
			}
			return true, nil // Continue the loop
		case <-ctx.Done():
			fmt.Printf("[Task %s] Context cancelled while waiting for input. Exiting.\n", t.ID)
			te.TaskStore.SetState(t.ID, TaskStateCanceled) // Set final state
			return false, ctx.Err()                        // Stop processing due to cancellation
		}

	} else {
		// Task Completed Successfully (No Input Required and No Tool Calls)
		log.Printf("[Task %s] Task completed normally (no input required, no tool calls).", t.ID)
		outputMessage := Message{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: fullResultString}}}

		// Update task output
		_, updateErr := te.TaskStore.UpdateTask(t.ID, func(task *Task) error {
			task.Output = append(task.Output, outputMessage)
			task.Error = "" // Clear any previous error
			return nil
		})
		if updateErr != nil {
			log.Printf("[Task %s] Failed to update task with completed output: %v", t.ID, updateErr)
			// State might already be COMPLETED, but log the error.
		}

		// Add artifact
		artifactErr := te.TaskStore.AddArtifact(t.ID, Artifact{Type: "text/plain", Filename: "llm_response.txt", Data: []byte(fullResultString)})
		if artifactErr != nil {
			fmt.Printf("[Task %s] Warning: Failed to save result as artifact: %v\n", t.ID, artifactErr)
		}

		// State should have been set to COMPLETED by the first-write goroutine in handleLLMExecution.
		// We can optionally log the current state or ensure it's COMPLETED again.
		finalTask, _ := te.TaskStore.GetTask(t.ID)
		if finalTask != nil && finalTask.State != TaskStateCompleted {
			log.Printf("[Task %s] Warning: Final state was %s, attempting to set COMPLETED again.", t.ID, finalTask.State)
			setStateErr := te.TaskStore.SetState(t.ID, TaskStateCompleted)
			if setStateErr != nil {
				log.Printf("[Task %s] Failed to ensure final task state is Completed: %v", t.ID, setStateErr)
			}
		}

		fmt.Printf("[Task %s] Processing finished.\n", t.ID)
		return false, nil // Stop the loop, task is complete
	}
}

// processTaskStreamIteration handles a single iteration of the main loop for ExecuteTaskStream.
// It returns true if the loop should continue (due to INPUT_REQUIRED or tool calls), false otherwise.
// It also returns any error encountered during the iteration that should stop the process.
func (te *TaskExecutor) processTaskStreamIteration(ctx context.Context, t *Task, sseWriter *SSEWriter, resumeCh chan struct{}) (continueLoop bool, err error) {
	currentTask, err := te.TaskStore.GetTask(t.ID)
	if err != nil {
		log.Printf("[Task %s Stream] Error getting task from store: %v", t.ID, err)
		failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": fmt.Sprintf("Failed to get task: %v", err)})
		sseWriter.SendEvent("state", string(failedStateData))
		return false, err // Stop processing
	}
	if currentTask.State == TaskStateCanceled {
		log.Printf("[Task %s Stream] Task cancelled externally. Stopping.", t.ID)
		// Optionally send a final SSE event for cancellation
		return false, nil // Stop processing
	}

	// Build messages for the LLM using the helper function
	llmMessages, contentFound, extractErr := buildPromptFromInput(t.ID, currentTask.Input, te.SystemMessage)
	if extractErr != nil {
		te.TaskStore.UpdateTask(t.ID, func(task *Task) error { task.Error = extractErr.Error(); return nil })
		te.TaskStore.SetState(t.ID, TaskStateFailed)
		fmt.Printf("[Task %s Stream] Failed during message building: %v\n", t.ID, extractErr)
		failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": extractErr.Error()})
		sseWriter.SendEvent("state", string(failedStateData))
		return false, extractErr // Stop processing
	}
	if !contentFound {
		errMsg := "could not extract suitable content from messages for LLM"
		te.TaskStore.UpdateTask(t.ID, func(task *Task) error { task.Error = errMsg; return nil })
		te.TaskStore.SetState(t.ID, TaskStateFailed)
		fmt.Printf("[Task %s Stream] Failed: %s\n", t.ID, errMsg)
		failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": errMsg})
		sseWriter.SendEvent("state", string(failedStateData))
		return false, fmt.Errorf(errMsg) // Stop processing
	}

	// Log the messages being sent to the LLM
	logMessages := ""
	for i, msg := range llmMessages {
		if i > 0 {
			logMessages += "\n---\n"
		}
		logMessages += fmt.Sprintf("Role: %s\nContent: %s", msg.Role, msg.Content)
	}
	if len(logMessages) > 500 { // Truncate log output if too long
		logMessages = logMessages[:500] + "..."
	}
	fmt.Printf("[Task %s Stream] Messages for LLM:\n---\n%s\n---\n", t.ID, logMessages)

	// Call the extracted LLM stream execution handler
	fullResultString, _, _, requiresInput, llmErr := handleLLMExecutionStream(ctx, t.ID, te.LLMClient, te.TaskStore, llmMessages, sseWriter) // Pass messages slice

	// Handle LLM error returned by the handler
	if llmErr != nil {
		// Error logging and state/SSE updates are handled within handleLLMExecutionStream
		return false, llmErr // Stop processing
	}

	// After LLM execution, check the *latest* task state and output for tool calls
	updatedTask, err := te.TaskStore.GetTask(t.ID)
	if err != nil {
		log.Printf("[Task %s Stream] Error getting task after LLM execution: %v", t.ID, err)
		failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": fmt.Sprintf("Failed to get task after LLM: %v", err)})
		sseWriter.SendEvent("state", string(failedStateData))
		return false, err // Stop processing
	}

	// Find the last message from the assistant (which should contain tool_calls if any)
	var lastAssistantMessage *Message
	for i := len(updatedTask.Output) - 1; i >= 0; i-- {
		if updatedTask.Output[i].Role == RoleAssistant {
			lastAssistantMessage = &updatedTask.Output[i]
			break
		}
	}

	if lastAssistantMessage != nil && len(lastAssistantMessage.ParsedToolCalls) > 0 {
		log.Printf("[Task %s Stream] Detected %d tool calls in LLM response.", t.ID, len(lastAssistantMessage.ParsedToolCalls))

		toolDispatcher := NewToolDispatcher(te.TaskStore) // Create a new dispatcher instance

		toolResults := []Message{}
		for _, toolCall := range lastAssistantMessage.ParsedToolCalls {
			toolResultMsg, dispatchErr := toolDispatcher.DispatchToolCall(ctx, t.ID, toolCall)
			if dispatchErr != nil {
				// Log the dispatch error but continue processing other tool calls
				log.Printf("[Task %s Stream] Error dispatching tool call %s (%s): %v", t.ID, toolCall.ID, toolCall.Function.Name, dispatchErr)
				// The DispatchToolCall function already includes an error message in the returned Message,
				// so we just append the message.
			}
			toolResults = append(toolResults, toolResultMsg)
		}

		// Append tool results to the task's input for the next LLM iteration
		_, updateErr := te.TaskStore.UpdateTask(t.ID, func(task *Task) error {
			task.Input = append(task.Input, toolResults...) // Append all tool result messages
			// Clear output after processing tool calls, as the next iteration starts with new input
			task.Output = []Message{}
			task.Error = "" // Clear any previous error
			return nil
		})
		if updateErr != nil {
			log.Printf("[Task %s Stream] Failed to update task with tool results: %v", t.ID, updateErr)
			te.TaskStore.SetState(t.ID, TaskStateFailed) // Set state to failed if we can't update task
			failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": fmt.Sprintf("Failed to update task with tool results: %v", updateErr)})
			sseWriter.SendEvent("state", string(failedStateData))
			return false, updateErr // Stop processing
		}

		log.Printf("[Task %s Stream] Appended %d tool result messages to input. Continuing loop.", t.ID, len(toolResults))
		// Set state back to Working before the next iteration
		if err := te.TaskStore.SetState(t.ID, TaskStateWorking); err != nil {
			log.Printf("[Task %s Stream] Failed to set state back to Working after tool calls: %v", t.ID, err)
			failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": fmt.Sprintf("Failed to set state after tool calls: %v", err)})
			sseWriter.SendEvent("state", string(failedStateData))
			return false, err // Stop processing if we can't reset state
		}
		// Send a state update event to the client
		workingStateData, _ := json.Marshal(map[string]string{"status": string(TaskStateWorking)})
		sseWriter.SendEvent("state", string(workingStateData))

		return true, nil // Continue the loop to send tool results to LLM

	} else if requiresInput {
		// Process the result based on whether input is required (if no tool calls were made)
		log.Printf("[Task %s Stream] Input Required detected in full response (no tool calls).", t.ID)
		outputMessage := Message{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: fullResultString}}}

		_, updateErr := te.TaskStore.UpdateTask(t.ID, func(task *Task) error {
			task.Output = append(task.Output, outputMessage)
			task.Error = ""
			return nil
		})
		if updateErr != nil {
			log.Printf("[Task %s Stream] Failed to update task with input required output: %v", t.ID, updateErr)
		}

		setStateErr := te.TaskStore.SetState(t.ID, TaskStateInputRequired)
		if setStateErr == nil {
			inputRequiredStateData, _ := json.Marshal(map[string]string{"status": string(TaskStateInputRequired)})
			sseWriter.SendEvent("state", string(inputRequiredStateData))
		} else {
			log.Printf("[Task %s Stream] Failed to set task state to InputRequired: %v", t.ID, setStateErr)
			failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": "Failed to transition to input-required state"})
			sseWriter.SendEvent("state", string(failedStateData))
		}
		fmt.Printf("[Task %s Stream] State set to InputRequired. Waiting for signal...\n", t.ID)

		select {
		case <-resumeCh:
			fmt.Printf("[Task %s Stream] Resume signal received. Continuing loop.\n", t.ID)
			workingStateData, _ := json.Marshal(map[string]string{"status": string(TaskStateWorking)})
			sseWriter.SendEvent("state", string(workingStateData))
			// Need to set state back to working in the store as well
			if err := te.TaskStore.SetState(t.ID, TaskStateWorking); err != nil {
				log.Printf("[Task %s Stream] Failed to set state back to Working after resume: %v", t.ID, err)
				// Send error state via SSE?
				return false, err // Stop processing
			}
			return true, nil // Continue loop
		case <-ctx.Done():
			fmt.Printf("[Task %s Stream] Context cancelled while waiting for input. Exiting.\n", t.ID)
			te.TaskStore.SetState(t.ID, TaskStateCanceled)
			// Optionally send final SSE event
			return false, ctx.Err() // Stop processing
		}
	} else {
		// Task Completed Successfully (No Input Required and No Tool Calls)
		log.Printf("[Task %s Stream] LLM streaming completed successfully.\n", t.ID)

		outputMessage := Message{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: fullResultString}}}
		_, updateErr := te.TaskStore.UpdateTask(t.ID, func(task *Task) error {
			task.Output = append(task.Output, outputMessage)
			task.Error = ""
			return nil
		})
		if updateErr != nil {
			log.Printf("[Task %s Stream] Failed to update task with completed output: %v\n", t.ID, updateErr)
		}

		artifactErr := te.TaskStore.AddArtifact(t.ID, Artifact{Type: "text/plain", Filename: "llm_streamed_response.txt", Data: []byte(fullResultString)})
		if artifactErr != nil {
			fmt.Printf("[Task %s Stream] Warning: Failed to save streamed result as artifact: %v\n", t.ID, artifactErr)
		}

		setStateErr := te.TaskStore.SetState(t.ID, TaskStateCompleted)
		if setStateErr == nil {
			completedStateData, _ := json.Marshal(map[string]string{"status": string(TaskStateCompleted)})
			sseWriter.SendEvent("state", string(completedStateData))
		} else {
			log.Printf("[Task %s Stream] Failed to set task state to Completed: %v\n", t.ID, setStateErr)
			failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": "Failed to finalize task state"})
			sseWriter.SendEvent("state", string(failedStateData))
		}
		fmt.Printf("[Task %s Stream] Completed.\n", t.ID)
		return false, nil // Stop the loop, task is complete
	}
}
