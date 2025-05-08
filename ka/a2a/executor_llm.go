package a2a

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"

	// No import for "kaba/ka/a2a" needed here
	"ka/llm"
)

// HandleLLMExecution calls the LLM, manages first-write state update, and handles results/errors.
// It now extracts and parses XML tool calls from the full response string.
func HandleLLMExecution(
	ctx context.Context,
	taskID string,
	llmClient *llm.LLMClient,
	taskStore TaskStore, // Use local TaskStore
	messages []llm.Message,
	sseWriter *SSEWriter,
	toolDispatcher *ToolDispatcher, // Add ToolDispatcher
) (fullResultString string, inputTokens, completionTokens int, requiresInput bool, err error) {

	var fullOutputBuffer bytes.Buffer
	signaller := newFirstWriteSignaller(&fullOutputBuffer)
	stateUpdateCompleted := make(chan bool, 1)

	// Goroutine to signal first write
	go func() {
		select {
		case <-signaller.firstWriteCh:
			log.Printf("[Task %s] First write detected by signaller.", taskID)
			// Do NOT set state to COMPLETED here. State transition is handled after LLM call returns.
			stateUpdateCompleted <- true
		case <-ctx.Done():
			log.Printf("[Task %s] Context cancelled before first write detected.", taskID)
			stateUpdateCompleted <- false
		}
	}()

	// Call LLM (Always Streaming Now)
	fullResultString, inputTokens, completionTokens, llmErr := llmClient.Chat(ctx, messages, true, signaller)

	// Ensure the first write signal goroutine has finished before proceeding
	<-stateUpdateCompleted

	// Handle LLM Result
	if llmErr != nil {
		finalState := TaskStateFailed // Use local TaskStateFailed
		errMsg := fmt.Sprintf("LLM stream failed: %v", llmErr)
		if errors.Is(llmErr, context.Canceled) || errors.Is(llmErr, context.DeadlineExceeded) {
			log.Printf("[Task %s] LLM stream cancelled or timed out: %v", taskID, llmErr)
			finalState = TaskStateCanceled // Use local TaskStateCanceled
			errMsg = fmt.Sprintf("LLM stream cancelled or timed out: %v", llmErr)
		} else {
			log.Printf("[Task %s] LLM stream failed: %v. Input Tokens: %d", taskID, llmErr, inputTokens)
		}

		_, updateErr := taskStore.UpdateTask(taskID, func(task *Task) error { // Use local Task
			task.Error = errMsg
			return nil
		})
		if updateErr != nil {
			log.Printf("[Task %s] Failed to update task with LLM error message: %v", taskID, updateErr)
		}

		setStateErr := taskStore.SetState(taskID, finalState)
		if setStateErr != nil {
			log.Printf("[Task %s] Failed to set final task state to %s after LLM error: %v", taskID, finalState, setStateErr)
		}
		return "", inputTokens, completionTokens, false, llmErr
	}

	// LLM Call Succeeded
	fmt.Printf("[Task %s] LLM Stream Success. Input Tokens: %d, Completion Tokens: %d\n", taskID, inputTokens, completionTokens)

	// --- Extract and Parse XML Tool Calls ---
	// The raw XML is now the full result string, which might contain multiple <tool> tags
	rawToolCallsXML := fullResultString

	// Create a Message object to hold the raw XML and parse it
	assistantMessage := Message{ // Use local Message
		Role:            RoleAssistant, // Use local RoleAssistant
		RawToolCallsXML: rawToolCallsXML, // Store the full response for parsing
		Parts:           []Part{TextPart{Type: "text", Text: fullResultString}}, // Use local Part, TextPart
	}

	// Parse the XML tool calls from the RawToolCallsXML field
	parseErr := assistantMessage.ParseToolCallsFromXML() // Call the method on the Message object
	if parseErr != nil {
		log.Printf("[Task %s] Error parsing XML tool calls: %v", taskID, parseErr)
		// Decide how to handle parsing errors. For now, log and continue,
		// the ParsedToolCalls slice will be empty.
	}

	// Update the task with the assistant message including parsed tool calls
	_, updateErr := taskStore.UpdateTask(taskID, func(task *Task) error { // Use local Task
		// Append the assistant message with the parsed tool calls
		task.Messages = append(task.Messages, assistantMessage) // Use Messages field
		task.Error = "" // Clear any previous error
		return nil
	})
	if updateErr != nil {
		log.Printf("[Task %s] Failed to update task with assistant message and parsed tool calls: %v", taskID, updateErr)
		// Consider setting state to failed here?
	}

	// Check if the full response requires input (still check the full string before XML removal)
	// requiresInput = strings.Contains(fullResultString, "[INPUT_REQUIRED]")

	// Tool calls are handled by the calling loop, which checks assistantMessage.ParsedToolCalls
	// requiresInput is true only if the LLM explicitly requested input using [INPUT_REQUIRED]

	// If tool calls were parsed, the calling loop will handle dispatching them
	// and adding results to messages in the next iteration.
	// requiresInput is true only if the LLM explicitly requested input using [INPUT_REQUIRED].

	// Determine the final state based on parsed tool calls and input requirement
	finalState := TaskStateCompleted // Assume completed by default
	if len(assistantMessage.ParsedToolCalls) > 0 {
		// If tool calls were parsed, the task is still working, waiting for tool execution results
		finalState = TaskStateWorking // Or a new state like TaskStateToolExecutionRequired
		log.Printf("[Task %s] Parsed %d tool calls. Setting state back to WORKING for tool execution.", taskID, len(assistantMessage.ParsedToolCalls))
	} else if requiresInput {
		// If no tool calls but input is required, set state to INPUT_REQUIRED
		finalState = TaskStateInputRequired
		log.Printf("[Task %s] Input required. Setting state to INPUT_REQUIRED.", taskID)
	} else {
		// If no tool calls and no input required, the task is truly completed
		log.Printf("[Task %s] No tool calls or input required. Setting state to COMPLETED.", taskID)
	}

	// Update the task state to the determined final state
	setStateErr := taskStore.SetState(taskID, finalState)
	if setStateErr != nil {
		log.Printf("[Task %s] Failed to set final task state to %s after LLM success: %v", taskID, finalState, setStateErr)
		// Decide how to handle this error - maybe return an error?
	}


	return fullResultString, inputTokens, completionTokens, requiresInput, nil
}

// handleLLMExecutionStream calls the LLM for streaming output directly to SSE.
// This function is primarily for streaming text output. Tool call parsing
// will happen after the full stream is received in handleLLMExecution.
func handleLLMExecutionStream(
	ctx context.Context,
	taskID string,
	llmClient *llm.LLMClient,
	taskStore TaskStore, // Use local TaskStore
	messages []llm.Message,
	sseWriter *SSEWriter,
	toolDispatcher *ToolDispatcher, // Add ToolDispatcher
) (fullResultString string, inputTokens, completionTokens int, requiresInput bool, err error) {

	log.Printf("[Task %s Stream] Sending prompt to LLM for streaming...\n", taskID)
	// The sseWriter will receive the raw stream, including any XML block.
	fullResultString, inputTokens, completionTokens, llmErr := llmClient.Chat(ctx, messages, true, sseWriter)

	if llmErr != nil {
		fmt.Printf("[Task %s Stream] LLM Error. Input Tokens: %d\n", taskID, inputTokens)
		finalState := TaskStateFailed // Use local TaskStateFailed
		errMsg := llmErr.Error()
		if errors.Is(llmErr, context.Canceled) || errors.Is(llmErr, context.DeadlineExceeded) {
			log.Printf("[Task %s Stream] LLM stream cancelled or timed out (client likely disconnected): %v\n", taskID, llmErr)
			finalState = TaskStateCanceled // Use local TaskStateCanceled
		} else {
			log.Printf("[Task %s Stream] LLM stream failed: %v\n", taskID, llmErr)
		}

		taskStore.UpdateTask(taskID, func(task *Task) error { task.Error = errMsg; return nil }) // Use local Task
		setStateErr := taskStore.SetState(taskID, finalState)

	if setStateErr == nil && finalState == TaskStateFailed { // Use local TaskStateFailed
		failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": errMsg}) // Use local TaskStateFailed
		sseWriter.SendEvent("state", string(failedStateData))
	} else if setStateErr != nil {
		log.Printf("[Task %s Stream] Failed to set final task state to %s after LLM error: %v\n", taskID, finalState, setStateErr)
	}
	return "", inputTokens, completionTokens, false, llmErr
}

	// Log token usage on success
	fmt.Printf("[Task %s Stream] LLM Success. Input Tokens: %d, Completion Tokens: %d\n", taskID, inputTokens, completionTokens)

	// For streaming, tool call parsing happens *after* the stream is complete
	// in the main processTaskStreamIteration loop. We just return the full result string here.
	// The requiresInput check based on [INPUT_REQUIRED] is still relevant for non-tool-call input requests.
	requiresInput = strings.Contains(fullResultString, "[INPUT_REQUIRED]")

	// For streaming, tool call parsing and execution happens after the full stream is received
	// in the main processTaskStreamIteration loop. requiresInput is true only if the LLM
	// explicitly requested input using [INPUT_REQUIRED].

	return fullResultString, inputTokens, completionTokens, requiresInput, nil
}
