package a2a

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"strings"
	"sync"

	"net/url"
	"clarifai-agent/llm"
)


type TaskExecutor struct {
	llmClient *llm.LLMClient
	taskStore TaskStore
	mu        sync.Mutex
	resumeChannels map[string]chan struct{}
}


func NewTaskExecutor(client *llm.LLMClient, store TaskStore) *TaskExecutor {
	return &TaskExecutor{
		llmClient:      client,
		taskStore:      store,
		resumeChannels: make(map[string]chan struct{}),
	}
}


func (te *TaskExecutor) registerChannel(taskID string) chan struct{} {
	te.mu.Lock()
	defer te.mu.Unlock()
	ch := make(chan struct{}, 1)
	te.resumeChannels[taskID] = ch
	log.Printf("[Executor] Registered resume channel for task %s", taskID)
	return ch
}


func (te *TaskExecutor) removeChannel(taskID string) {
	te.mu.Lock()
	defer te.mu.Unlock()
	delete(te.resumeChannels, taskID)
	log.Printf("[Executor] Removed resume channel for task %s", taskID)
}


func (te *TaskExecutor) getChannel(taskID string) (chan struct{}, bool) {
	te.mu.Lock()
	defer te.mu.Unlock()
	ch, ok := te.resumeChannels[taskID]
	return ch, ok
}


func (te *TaskExecutor) ExecuteTask(task *Task, requestContext context.Context) {
	taskID := task.ID
	resumeCh := te.registerChannel(taskID)

	go func(t *Task, ctx context.Context) {

		defer te.removeChannel(t.ID)

		fmt.Printf("[Task %s] Starting processing via Executor...\n", t.ID)
		te.taskStore.SetState(t.ID, TaskStateWorking)


		for {

			currentTask, err := te.taskStore.GetTask(t.ID)
			if err != nil {
				log.Printf("[Task %s] Error getting task from store during execution: %v", t.ID, err)

				return
			}
			if currentTask.State == TaskStateCanceled {
				log.Printf("[Task %s] Task was cancelled externally. Stopping.", t.ID)
				return
			}


			var promptBuilder strings.Builder
			var extractErr error
			promptFound := false
			userMessageFound := false // Added check for user role

			if len(currentTask.Input) > 0 {
				// First pass: Check for at least one user message
				for _, msg := range currentTask.Input {
					if msg.Role == RoleUser {
						userMessageFound = true
						break
					}
				}

				if !userMessageFound {
					extractErr = fmt.Errorf("input validation failed: no message with role '%s' found", RoleUser)
					te.taskStore.UpdateTask(t.ID, func(task *Task) error {
						task.Error = extractErr.Error()
						return nil
					})
					te.taskStore.SetState(t.ID, TaskStateFailed)
					fmt.Printf("[Task %s] Failed: %v\n", t.ID, extractErr)
					return
				}

				// Second pass: Build the prompt string


				for _, msg := range currentTask.Input {
					if msg.Role == RoleUser || msg.Role == RoleAssistant {
						for _, part := range msg.Parts {
							if promptBuilder.Len() > 0 {
								promptBuilder.WriteString("\n\n---\n\n")
							}
							switch p := part.(type) {
							case TextPart:
								promptBuilder.WriteString(p.Text)
								promptFound = true
							case FilePart:
								promptBuilder.WriteString(fmt.Sprintf("[File: %s (%s)]", p.URI, p.MimeType))

							case DataPart:
								promptBuilder.WriteString(fmt.Sprintf("[Data: %s]", p.MimeType))
							default:
								promptBuilder.WriteString(fmt.Sprintf("[Unknown Part Type: %T]", p))
							}
						}
					}
				}
			}

			if !promptFound {
				extractErr = fmt.Errorf("could not extract suitable prompt content from messages")
				te.taskStore.UpdateTask(t.ID, func(task *Task) error {
					task.Error = extractErr.Error()
					return nil
				})
				te.taskStore.SetState(t.ID, TaskStateFailed)
				fmt.Printf("[Task %s] Failed: %v\n", t.ID, extractErr)
				return
			}

			prompt := promptBuilder.String()
			logPrompt := prompt
			if len(logPrompt) > 200 {
				logPrompt = logPrompt[:200] + "..."
			}
			fmt.Printf("[Task %s] Combined prompt for LLM:\n---\n%s\n---\n", t.ID, logPrompt)



			var resultBuffer bytes.Buffer

			err = te.llmClient.Chat(ctx, prompt, false, &resultBuffer) // Pass context
			result := resultBuffer.String()


			if err != nil {
				te.taskStore.UpdateTask(t.ID, func(task *Task) error {
					task.Error = err.Error()
					return nil
				})
				te.taskStore.SetState(t.ID, TaskStateFailed)
				fmt.Printf("[Task %s] Failed during LLM call: %v\n", t.ID, err)
				return
			} else if strings.Contains(result, "[INPUT_REQUIRED]") {

				outputMessage := Message{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: result}}}
				_, updateErr := te.taskStore.UpdateTask(t.ID, func(task *Task) error {
					task.Output = append(task.Output, outputMessage)
					task.Error = ""
					return nil
				})
				if updateErr != nil {
					fmt.Printf("[Task %s] Failed to update task with input required output: %v\n", t.ID, updateErr)

				}


				setStateErr := te.taskStore.SetState(t.ID, TaskStateInputRequired)
				if setStateErr != nil {
					fmt.Printf("[Task %s] Failed to set task state to InputRequired: %v\n", t.ID, setStateErr)
					return
				}
				fmt.Printf("[Task %s] Input Required. Waiting for signal...\n", t.ID)


				select {
				case <-resumeCh:
					fmt.Printf("[Task %s] Resume signal received. Continuing loop.\n", t.ID)


					continue
				case <-ctx.Done():
					fmt.Printf("[Task %s] Context cancelled while waiting for input. Exiting.\n", t.ID)

					te.taskStore.SetState(t.ID, TaskStateCanceled)
					return
				}
			} else {

				outputMessage := Message{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: result}}}
				_, updateErr := te.taskStore.UpdateTask(t.ID, func(task *Task) error {
					task.Output = append(task.Output, outputMessage)
					task.Error = ""
					return nil
				})
				if updateErr != nil {
					fmt.Printf("[Task %s] Failed to update task with completed output: %v\n", t.ID, updateErr)
				}


				artifactErr := te.taskStore.AddArtifact(t.ID, Artifact{Type: "text/plain", Filename: "llm_response.txt", Data: []byte(result)})
				if artifactErr != nil {
					fmt.Printf("[Task %s] Warning: Failed to save result as artifact: %v\n", t.ID, artifactErr)
				}


				setStateErr := te.taskStore.SetState(t.ID, TaskStateCompleted)
				if setStateErr != nil {
					fmt.Printf("[Task %s] Failed to set task state to Completed: %v\n", t.ID, setStateErr)
				}
				fmt.Printf("[Task %s] Completed.\n", t.ID)
				return
			}
		}
	}(task, requestContext)
}

// isValidFileURI performs basic validation on a file URI.
// It checks if it's a valid URL and currently only allows the "file" scheme.
func isValidFileURI(uri string) bool {
	u, err := url.Parse(uri)
	if err != nil {
		return false
	}
	// Currently only allow file:// scheme
	return u.Scheme == "file"
}


func (te *TaskExecutor) ResumeTask(taskID string) error {
	resumeCh, ok := te.getChannel(taskID)
	if !ok {
		log.Printf("[Executor] No resume channel found for task %s (already resumed or finished?)", taskID)

		return fmt.Errorf("task %s not actively waiting for input", taskID)
	}


	err := te.taskStore.SetState(taskID, TaskStateWorking)
	if err != nil {
		log.Printf("[Executor] Failed to set task %s state to working before resuming: %v", taskID, err)
		return fmt.Errorf("failed to set task state to working: %w", err)
	}


	select {
	case resumeCh <- struct{}{}:
		log.Printf("[Executor] Sent resume signal to task %s", taskID)


	default:

		log.Printf("[Executor] Warning: Could not send resume signal to task %s (channel full or closed?)", taskID)
	}

	return nil
}


func (te *TaskExecutor) ExecuteTaskStream(task *Task, requestContext context.Context, sseWriter *SSEWriter) {
	taskID := task.ID
	resumeCh := te.registerChannel(taskID)



	go func(t *Task, ctx context.Context) {

		defer te.removeChannel(t.ID)

		fmt.Printf("[Task %s Stream] Starting processing via Executor...\n", t.ID)

		workingStateData, _ := json.Marshal(map[string]string{"status": string(TaskStateWorking)})
		sseWriter.SendEvent("state", string(workingStateData))

		te.taskStore.SetState(t.ID, TaskStateWorking)


		for {

			currentTask, err := te.taskStore.GetTask(t.ID)
			if err != nil {
				log.Printf("[Task %s Stream] Error getting task from store: %v", t.ID, err)
				failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": fmt.Sprintf("Failed to get task: %v", err)})
				sseWriter.SendEvent("state", string(failedStateData))
				return
			}
			if currentTask.State == TaskStateCanceled {
				log.Printf("[Task %s Stream] Task cancelled externally. Stopping.", t.ID)

				return
			}


			var promptBuilder strings.Builder
			var extractErr error
			promptFound := false
			userMessageFound := false // Added check for user role

			if len(currentTask.Input) > 0 {
				// First pass: Check for at least one user message
				for _, msg := range currentTask.Input {
					if msg.Role == RoleUser {
						userMessageFound = true
						break
					}
				}

				if !userMessageFound {
					extractErr = fmt.Errorf("input validation failed: no message with role '%s' found", RoleUser)
					te.taskStore.UpdateTask(t.ID, func(task *Task) error { task.Error = extractErr.Error(); return nil })
					te.taskStore.SetState(t.ID, TaskStateFailed)
					fmt.Printf("[Task %s Stream] Failed: %v\n", t.ID, extractErr)
					failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": extractErr.Error()})
					sseWriter.SendEvent("state", string(failedStateData))
					return
				}

				// Second pass: Build the prompt string
				for _, msg := range currentTask.Input {
					if msg.Role == RoleUser || msg.Role == RoleAssistant {
						for _, part := range msg.Parts {
							if promptBuilder.Len() > 0 { promptBuilder.WriteString("\n\n---\n\n") }
							switch p := part.(type) {
							case TextPart:
								promptBuilder.WriteString(p.Text); promptFound = true
							case FilePart:
								if !isValidFileURI(p.URI) {
									extractErr = fmt.Errorf("invalid file URI format or scheme: %s", p.URI)
									// Break out of inner loops and handle error below
									goto handleExtractionError
								}
								// TODO: Handlers need logic to process non-TextPart inputs (e.g., download files from URI)
								// For now, just include the URI in the prompt
								promptBuilder.WriteString(fmt.Sprintf("[File: %s (%s)]", p.URI, p.MimeType))
								promptFound = true // Consider file parts as contributing to prompt content
							case DataPart:
								promptBuilder.WriteString(fmt.Sprintf("[Data: %s]", p.MimeType))
								promptFound = true // Consider data parts as contributing to prompt content
							default:
								promptBuilder.WriteString(fmt.Sprintf("[Unknown Part Type: %T]", p))
							}
						}
					}
				}
			}

		handleExtractionError: // Label to jump to on extraction error
			if extractErr != nil || !promptFound {
				if extractErr == nil {
					extractErr = fmt.Errorf("could not extract suitable prompt content")
				}
				te.taskStore.UpdateTask(t.ID, func(task *Task) error { task.Error = extractErr.Error(); return nil })
				te.taskStore.SetState(t.ID, TaskStateFailed)
				fmt.Printf("[Task %s Stream] Failed: %v\n", t.ID, extractErr)
				failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": extractErr.Error()})
				sseWriter.SendEvent("state", string(failedStateData))
				return
			}
			prompt := promptBuilder.String()
			logPrompt := prompt
			if len(logPrompt) > 200 { logPrompt = logPrompt[:200] + "..." }
			fmt.Printf("[Task %s Stream] Combined prompt for LLM:\n---\n%s\n---\n", t.ID, logPrompt)



			log.Printf("[Task %s Stream] Sending prompt to LLM for streaming...\n", t.ID)
			var responseBuffer bytes.Buffer
			multiWriter := io.MultiWriter(sseWriter, &responseBuffer)


			llmErr := te.llmClient.Chat(ctx, prompt, true, multiWriter) // Pass context
			fullResultString := responseBuffer.String()



			if llmErr != nil {

				finalState := TaskStateFailed
				if errors.Is(llmErr, context.Canceled) || errors.Is(llmErr, context.DeadlineExceeded) {
					log.Printf("[Task %s Stream] LLM stream cancelled or timed out (client likely disconnected): %v\n", t.ID, llmErr)
					finalState = TaskStateCanceled
				} else {
					log.Printf("[Task %s Stream] LLM stream failed: %v\n", t.ID, llmErr)
				}

				te.taskStore.UpdateTask(t.ID, func(task *Task) error { task.Error = llmErr.Error(); return nil })
				setStateErr := te.taskStore.SetState(t.ID, finalState)

				if setStateErr == nil && finalState == TaskStateFailed {
					failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": llmErr.Error()})
					sseWriter.SendEvent("state", string(failedStateData))
				} else if setStateErr != nil {
					log.Printf("[Task %s Stream] Failed to set final task state to %s after LLM error: %v\n", t.ID, finalState, setStateErr)
				}
				return
			} else if strings.Contains(fullResultString, "[INPUT_REQUIRED]") {

				log.Printf("[Task %s Stream] LLM streaming completed, input required.\n", t.ID)

				outputMessage := Message{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: fullResultString}}}
				_, updateErr := te.taskStore.UpdateTask(t.ID, func(task *Task) error {
					task.Output = append(task.Output, outputMessage)
					task.Error = ""
					return nil
				})
				if updateErr != nil {
					log.Printf("[Task %s Stream] Failed to update task with input required output: %v\n", t.ID, updateErr)
				}


				setStateErr := te.taskStore.SetState(t.ID, TaskStateInputRequired)
				if setStateErr == nil {
					inputRequiredStateData, _ := json.Marshal(map[string]string{"status": string(TaskStateInputRequired)})
					sseWriter.SendEvent("state", string(inputRequiredStateData))
				} else {
					log.Printf("[Task %s Stream] Failed to set task state to InputRequired: %v\n", t.ID, setStateErr)

					failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": "Failed to transition to input-required state"})
					sseWriter.SendEvent("state", string(failedStateData))
					return
				}
				fmt.Printf("[Task %s Stream] Input Required. Waiting for signal...\n", t.ID)


				select {
				case <-resumeCh:
					fmt.Printf("[Task %s Stream] Resume signal received. Continuing loop.\n", t.ID)

					workingStateData, _ := json.Marshal(map[string]string{"status": string(TaskStateWorking)})
					sseWriter.SendEvent("state", string(workingStateData))
					continue
				case <-ctx.Done():
					fmt.Printf("[Task %s Stream] Context cancelled while waiting for input. Exiting.\n", t.ID)
					te.taskStore.SetState(t.ID, TaskStateCanceled)

					return
				}
			} else {

				log.Printf("[Task %s Stream] LLM streaming completed successfully.\n", t.ID)

				outputMessage := Message{Role: RoleAssistant, Parts: []Part{TextPart{Type: "text", Text: fullResultString}}}
				_, updateErr := te.taskStore.UpdateTask(t.ID, func(task *Task) error {
					task.Output = append(task.Output, outputMessage)
					task.Error = ""
					return nil
				})
				if updateErr != nil {
					log.Printf("[Task %s Stream] Failed to update task with completed output: %v\n", t.ID, updateErr)
				}


				artifactErr := te.taskStore.AddArtifact(t.ID, Artifact{Type: "text/plain", Filename: "llm_streamed_response.txt", Data: []byte(fullResultString)})
				if artifactErr != nil {
					fmt.Printf("[Task %s Stream] Warning: Failed to save streamed result as artifact: %v\n", t.ID, artifactErr)
				}


				setStateErr := te.taskStore.SetState(t.ID, TaskStateCompleted)
				if setStateErr == nil {
					completedStateData, _ := json.Marshal(map[string]string{"status": string(TaskStateCompleted)})
					sseWriter.SendEvent("state", string(completedStateData))
				} else {
					log.Printf("[Task %s Stream] Failed to set task state to Completed: %v\n", t.ID, setStateErr)

					failedStateData, _ := json.Marshal(map[string]interface{}{"status": string(TaskStateFailed), "error": "Failed to finalize task state"})
					sseWriter.SendEvent("state", string(failedStateData))
				}
				fmt.Printf("[Task %s Stream] Completed.\n", t.ID)
				return
			}
		}
	}(task, requestContext)
}
