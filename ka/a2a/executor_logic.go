package a2a

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"strings"
)

// ExecuteTask runs a task to completion, handling LLM calls and tool execution.
// It does NOT stream output.
func (te *TaskExecutor) ExecuteTask(ctx context.Context, t *Task) {
	log.Printf("[Task %s] Starting execution.", t.ID)
	defer log.Printf("[Task %s] Execution finished.", t.ID)

	// Ensure task state is Working
	if err := te.TaskStore.SetState(t.ID, TaskStateWorking); err != nil {
		log.Printf("[Task %s] Failed to set state to Working: %v", t.ID, err)
		// Attempt to set state to Failed if we can't set to Working
		te.TaskStore.SetState(t.ID, TaskStateFailed)
		return // Stop execution if initial state cannot be set
	}

	// Get or create the resume channel for this task
	resumeCh := te.getOrCreateResumeChannel(t.ID)
	defer te.deleteResumeChannel(t.ID) // Clean up the channel when execution finishes

	// Main task execution loop
	for {
		select {
		case <-ctx.Done():
			log.Printf("[Task %s] Context cancelled. Stopping execution.", t.ID)
			te.TaskStore.SetState(t.ID, TaskStateCanceled)
			return // Exit the goroutine
		default:
			// Continue execution
		}

		// Process one iteration of the task logic
		continueLoop, err := te.processTaskIteration(ctx, t, resumeCh)
		if err != nil {
			log.Printf("[Task %s] Iteration error: %v. Stopping execution.", t.ID, err)
			// State should already be Failed if processTaskIteration returned an error
			return // Exit the goroutine on error
		}
		if !continueLoop {
			log.Printf("[Task %s] Iteration finished, no more steps required. Stopping execution.", t.ID)
			// State should already be Completed or InputRequired or Failed
			return // Exit the goroutine if no more steps are needed
		}
		// If continueLoop is true, the state should have been set back to Working
		// or InputRequired within processTaskIteration.
	}
}

// ExecuteTaskStream runs a task and streams output via SSE.
func (te *TaskExecutor) ExecuteTaskStream(ctx context.Context, t *Task, sseWriter *SSEWriter) {
	log.Printf("[Task %s Stream] Starting execution.", t.ID)
	defer log.Printf("[Task %s Stream] Execution finished.", t.ID)

	// Ensure task state is Working and send SSE update
	if err := te.TaskStore.SetState(t.ID, TaskStateWorking); err != nil {
		log.Printf("[Task %s Stream] Failed to set state to Working: %v", t.ID, err)
		// Attempt to set state to Failed and send SSE update
		te.TaskStore.SetState(t.ID, TaskStateFailed)
		failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": fmt.Sprintf("Failed to set initial state: %v", err)})
		sseWriter.SendEvent("state", string(failedStateData))
		return // Stop execution
	}
	workingStateData, _ := json.Marshal(map[string]string{"status": string(TaskStateWorking)})
	sseWriter.SendEvent("state", string(workingStateData))

	// Get or create the resume channel for this task
	resumeCh := te.getOrCreateResumeChannel(t.ID)
	defer te.deleteResumeChannel(t.ID) // Clean up the channel when execution finishes

	// Main task execution loop
	for {
		select {
		case <-ctx.Done():
			log.Printf("[Task %s Stream] Context cancelled. Stopping execution.", t.ID)
			te.TaskStore.SetState(t.ID, TaskStateCanceled)
			// Optionally send a final SSE event for cancellation
			return // Exit the goroutine
		default:
			// Continue execution
		}

		// Process one iteration of the task logic (streaming version)
		continueLoop, err := te.processTaskStreamIteration(ctx, t, sseWriter, resumeCh)
		if err != nil {
			log.Printf("[Task %s Stream] Iteration error: %v. Stopping execution.", t.ID, err)
			// Error logging and state/SSE updates are handled within processTaskStreamIteration
			return // Exit the goroutine on error
		}
		if !continueLoop {
			log.Printf("[Task %s Stream] Iteration finished, no more steps required. Stopping execution.", t.ID)
			// State should already be Completed or InputRequired or Failed
			return // Exit the goroutine if no more steps are needed
		}
		// If continueLoop is true, the state should have been set back to Working
		// or InputRequired within processTaskStreamIteration.
	}
}

// ResumeTask signals a task that is waiting for input to resume execution.
func (te *TaskExecutor) ResumeTask(taskID string) error {
	te.mu.Lock()
	defer te.mu.Unlock()

	resumeCh, ok := te.resumeChannels[taskID]
	if !ok {
		return fmt.Errorf("no active task found with ID %s waiting for input", taskID)
	}

	// Signal the task to resume
	select {
	case resumeCh <- struct{}{}:
		log.Printf("[Task %s] Signaled to resume.", taskID)
		return nil
	default:
		// This case should ideally not be hit if the task is correctly waiting on the channel
		return fmt.Errorf("task %s is not currently waiting for input", taskID)
	}
}

// getOrCreateResumeChannel gets the resume channel for a task, creating it if it doesn't exist.
func (te *TaskExecutor) getOrCreateResumeChannel(taskID string) chan struct{} {
	te.mu.Lock()
	defer te.mu.Unlock()

	ch, ok := te.resumeChannels[taskID]
	if !ok {
		ch = make(chan struct{}, 1) // Use a buffered channel of size 1
		te.resumeChannels[taskID] = ch
		log.Printf("[Task %s] Created resume channel.", taskID)
	}
	return ch
}

// deleteResumeChannel removes the resume channel for a task.
func (te *TaskExecutor) deleteResumeChannel(taskID string) {
	te.mu.Lock()
	defer te.mu.Unlock()

	if ch, ok := te.resumeChannels[taskID]; ok {
		close(ch) // Close the channel
		delete(te.resumeChannels, taskID)
		log.Printf("[Task %s] Deleted resume channel.", taskID)
	}
}

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

	// Build messages for the LLM using the helper function, using the task's SystemPrompt and all messages
	llmMessages, contentFound, extractErr := buildPromptFromInput(t.ID, currentTask.Messages, currentTask.SystemPrompt) // Use currentTask.Messages
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
	// Pass nil for sseWriter as this is the non-streaming path
	// Pass the toolDispatcher
	fullResultString, _, _, requiresInput, assistantMessageSaved, llmErr := HandleLLMExecution(ctx, t.ID, te.LLMClient, te.TaskStore, llmMessages, nil, NewToolDispatcher(te.TaskStore, te.AvailableTools))

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
	for i := len(updatedTask.Messages) - 1; i >= 0; i-- { // Look in Messages
		if updatedTask.Messages[i].Role == RoleAssistant {
			lastAssistantMessage = &updatedTask.Messages[i]
			break
		}
	}

	if lastAssistantMessage != nil && len(lastAssistantMessage.ParsedToolCalls) > 0 {
		log.Printf("[Task %s] Detected %d tool calls in LLM response.", t.ID, len(lastAssistantMessage.ParsedToolCalls))

		// Pass the map of available tools to the dispatcher
		toolDispatcher := NewToolDispatcher(te.TaskStore, te.AvailableTools) // Pass te.AvailableTools

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

		// Append tool results to the task's messages for the next LLM iteration
		_, updateErr := te.TaskStore.UpdateTask(t.ID, func(task *Task) error {
			task.Messages = append(task.Messages, toolResults...) // Append all tool result messages to Messages
			task.Error = ""                                       // Clear any previous error
			return nil
		})
		if updateErr != nil {
			log.Printf("[Task %s] Failed to update task with tool results: %v", t.ID, updateErr)
			te.TaskStore.SetState(t.ID, TaskStateFailed) // Set state to failed if we can't update task
			return false, updateErr                      // Stop processing
		}

		log.Printf("[Task %s] Appended %d tool result messages to messages. Continuing loop.", t.ID, len(toolResults))
		// Set state back to Working before the next iteration
		if err := te.TaskStore.SetState(t.ID, TaskStateWorking); err != nil {
			log.Printf("[Task %s] Failed to set state back to Working after tool calls: %v", t.ID, err)
			return false, err // Stop processing if we can't reset state
		}
		return true, nil // Continue the loop to send tool results to LLM

	} else if requiresInput {
		// Process the result based on whether input is required (if no tool calls were made)
		log.Printf("[Task %s] Input Required detected in full response (no tool calls).", t.ID)
		if !assistantMessageSaved { // Only add if HandleLLMExecution didn't already
			outputMessage := Message{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: fullResultString}}}
			_, updateErr := te.TaskStore.UpdateTask(t.ID, func(task *Task) error {
				task.Messages = append(task.Messages, outputMessage) // Append to Messages
				task.Error = ""                                      // Clear any previous error
				return nil
			})
			if updateErr != nil {
				log.Printf("[Task %s] Failed to update task with input required output: %v", t.ID, updateErr)
				// Consider setting state to failed here? For now, just log.
			}
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
		if !assistantMessageSaved { // Only add if HandleLLMExecution didn't already
			outputMessage := Message{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: fullResultString}}}
			// Update task messages
			_, updateErr := te.TaskStore.UpdateTask(t.ID, func(task *Task) error {
				task.Messages = append(task.Messages, outputMessage) // Append to Messages
				task.Error = ""                                      // Clear any previous error
				return nil
			})
			if updateErr != nil {
				log.Printf("[Task %s] Failed to update task with completed output: %v", t.ID, updateErr)
				// State might already be COMPLETED, but log the error.
			}
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
		return false, err
	}
	if currentTask.State == TaskStateCanceled {
		log.Printf("[Task %s Stream] Task was cancelled externally. Stopping.", t.ID)
		// Optionally send a final SSE event for cancellation
		return false, nil // Stop processing
	}

	// Build messages for the LLM using the helper function, using the task's SystemPrompt and all messages
	llmMessages, contentFound, extractErr := buildPromptFromInput(t.ID, currentTask.Messages, currentTask.SystemPrompt) // Use currentTask.Messages
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
	fullResultString, _, _, requiresInput, assistantMessageSaved, llmErr := handleLLMExecutionStream(ctx, t.ID, te.LLMClient, te.TaskStore, llmMessages, sseWriter, NewToolDispatcher(te.TaskStore, te.AvailableTools))

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
	for i := len(updatedTask.Messages) - 1; i >= 0; i-- { // Look in Messages
		if updatedTask.Messages[i].Role == RoleAssistant {
			lastAssistantMessage = &updatedTask.Messages[i]
			break
		}
	}

	if lastAssistantMessage != nil && len(lastAssistantMessage.ParsedToolCalls) > 0 {
		log.Printf("[Task %s Stream] Detected %d tool calls in LLM response.", t.ID, len(lastAssistantMessage.ParsedToolCalls))

		// Pass the map of available tools to the dispatcher
		toolDispatcher := NewToolDispatcher(te.TaskStore, te.AvailableTools) // Pass te.AvailableTools

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

		// Append tool results to the task's messages for the next LLM iteration
		_, updateErr := te.TaskStore.UpdateTask(t.ID, func(task *Task) error {
			task.Messages = append(task.Messages, toolResults...) // Append all tool result messages to Messages
			task.Error = ""                                       // Clear any previous error
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
		if !assistantMessageSaved { // Only add if handleLLMExecutionStream didn't already (it doesn't, but for consistency)
			outputMessage := Message{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: fullResultString}}}
			_, updateErr := te.TaskStore.UpdateTask(t.ID, func(task *Task) error {
				task.Messages = append(task.Messages, outputMessage) // Append to Messages
				task.Error = ""
				return nil
			})
			if updateErr != nil {
				log.Printf("[Task %s Stream] Failed to update task with input required output: %v", t.ID, updateErr)
			}
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

		if !assistantMessageSaved { // Only add if handleLLMExecutionStream didn't already (it doesn't, but for consistency)
			outputMessage := Message{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: fullResultString}}}
			_, updateErr := te.TaskStore.UpdateTask(t.ID, func(task *Task) error {
				task.Messages = append(task.Messages, outputMessage) // Append to Messages
				task.Error = ""
				return nil
			})
			if updateErr != nil {
				log.Printf("[Task %s Stream] Failed to update task with completed output: %v\n", t.ID, updateErr)
			}
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

// extractToolCodeXML finds and extracts the content within <tool_code>...</tool_code> tags.
func extractToolCodeXML(text string) string {
	startTag := "<tool_code>"
	endTag := "</tool_code>"

	startIndex := strings.Index(text, startTag)
	if startIndex == -1 {
		return "" // No start tag found
	}

	endIndex := strings.Index(text[startIndex+len(startTag):], endTag)
	if endIndex == -1 {
		// Start tag found, but no end tag. Return empty or the content until the end?
		// Returning empty is safer to avoid incomplete XML.
		return ""
	}

	// Calculate the end index in the original string
	endIndex = startIndex + len(startTag) + endIndex

	// Extract the content including the tags
	return text[startIndex : endIndex+len(endTag)]
}

// containsInputRequiredPhrase checks if the LLM's response contains a phrase indicating it needs input.
func containsInputRequiredPhrase(text string) bool {
	// This is a simple heuristic. A more robust approach might involve
	// the LLM explicitly signaling this or using a structured output.
	// For now, check for common phrases.
	lowerText := strings.ToLower(text)
	return strings.Contains(lowerText, "input required") ||
		strings.Contains(lowerText, "waiting for input") ||
		strings.Contains(lowerText, "please provide") // Add other phrases as needed
}
