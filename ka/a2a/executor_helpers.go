package a2a

import (
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"

	"ka/llm" // Import the llm package
)

type firstWriteSignaller struct {
	target io.Writer
	firstWriteCh chan struct{}
	written      atomic.Bool
}

func newFirstWriteSignaller(target io.Writer) *firstWriteSignaller {
	return &firstWriteSignaller{
		target:       target,
		firstWriteCh: make(chan struct{}),
	}
}

func (fws *firstWriteSignaller) Write(p []byte) (n int, err error) {
	if fws.written.CompareAndSwap(false, true) {
		close(fws.firstWriteCh)
		log.Println("[firstWriteSignaller] First write detected, signalling.")
	}
	return fws.target.Write(p)
}

func isValidPartURI(uri string) (u *url.URL, ok bool) {
	if strings.HasPrefix(uri, "data:") {
		return &url.URL{Scheme: "data", Opaque: strings.SplitN(uri, ":", 2)[1]}, true
	}

	parsedURL, err := url.Parse(uri)
	if err != nil {
		return nil, false
	}

	switch parsedURL.Scheme {
	case "file", "http", "https":
		return parsedURL, true
	default:
		return nil, false
	}
}

func downloadHTTPContent(uri string, maxSize int64) ([]byte, error) {
	resp, err := http.Get(uri)
	if err != nil {
		return nil, fmt.Errorf("failed to fetch URI %s: %w", uri, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("failed to fetch URI %s: status code %d, body: %s", uri, resp.StatusCode, string(bodyBytes))
	}

	limitedReader := &io.LimitedReader{R: resp.Body, N: maxSize}
	content, err := io.ReadAll(limitedReader)
	if err != nil {
		return nil, fmt.Errorf("failed to read content from URI %s: %w", uri, err)
	}

	if limitedReader.N == 0 && len(content) == int(maxSize) {
		log.Printf("Warning: Content from %s exceeded maxSize %d, truncated.", uri, maxSize)
	}

	return content, nil
}

func decodeDataURI(uri string) ([]byte, error) {
	if !strings.HasPrefix(uri, "data:") {
		return nil, fmt.Errorf("invalid data URI: does not start with 'data:'")
	}

	commaIndex := strings.Index(uri, ",")
	if commaIndex == -1 {
		return nil, fmt.Errorf("invalid data URI: missing comma separator")
	}

	encodedData := uri[commaIndex+1:]
	meta := uri[5:commaIndex]
	isBase64 := strings.Contains(meta, ";base64")

	if isBase64 {
		decodedData, err := base64.StdEncoding.DecodeString(encodedData)
		if err != nil {
			return nil, fmt.Errorf("failed to decode base64 data: %w", err)
		}
		return decodedData, nil
	} else {
		return nil, fmt.Errorf("data URI is not marked as base64 encoded")
	}
}

// buildPromptFromInput constructs the LLM messages slice from task input messages,
// including the agent's system message.
// It returns a slice of llm.Message, a boolean indicating if any relevant content was found, and an error.
func buildPromptFromInput(taskID string, inputMessages []Message, agentSystemMessage string) (messages []llm.Message, contentFound bool, err error) { // Added agentSystemMessage parameter
	var llmMessages []llm.Message
	userMessageFound := false
	contentFound = false // Initialize contentFound

	// Prepend the agent's system message if it exists
	if agentSystemMessage != "" {
		llmMessages = append(llmMessages, llm.Message{
			Role:    string(RoleSystem),
			Content: agentSystemMessage,
		})
		contentFound = true // System message counts as content
	}


	if len(inputMessages) == 0 {
		// If there's a system message but no other input, it's still valid
		if agentSystemMessage != "" {
			return llmMessages, true, nil
		}
		return nil, false, nil // No input, no prompt
	}

	// First pass: Check for at least one user message
	for _, msg := range inputMessages {
		if msg.Role == RoleUser {
			userMessageFound = true
			break
		}
	}

	if !userMessageFound {
		return nil, false, fmt.Errorf("input validation failed: no message with role '%s' found", RoleUser)
	}

	// Second pass: Build the prompt string from input messages
	for _, msg := range inputMessages {
		// Include messages from User, Assistant, and Tool roles (System already handled)
		if msg.Role == RoleUser || msg.Role == RoleAssistant || msg.Role == RoleTool {
			var messageContentBuilder strings.Builder
			// For Assistant messages with tool_calls, include the tool_calls JSON
			if msg.Role == RoleAssistant && len(msg.ToolCalls) > 0 {
				messageContentBuilder.WriteString(fmt.Sprintf("[TOOL_CALLS]: %s\n", string(msg.ToolCalls)))
				contentFound = true // Tool calls contribute to content
			}

			// Include parts for all relevant roles
			for _, part := range msg.Parts {
				switch p := part.(type) {
				case TextPart:
					messageContentBuilder.WriteString(p.Text)
					contentFound = true
				case FilePart:
					parsedURI, ok := isValidPartURI(p.URI)
					if !ok {
						log.Printf("[Task %s] Warning: Invalid or unsupported URI scheme in FilePart: %s", taskID, p.URI)
						messageContentBuilder.WriteString(fmt.Sprintf("[Invalid File URI: %s]", p.URI))
						continue // Skip this part but continue with others
					}

					switch parsedURI.Scheme {
					case "http", "https":
						const maxDownloadSize = 1024 * 1024 // 1MB limit
						content, downloadErr := downloadHTTPContent(p.URI, maxDownloadSize)
						if downloadErr != nil {
							log.Printf("[Task %s] Error downloading FilePart content from %s: %v", taskID, p.URI, downloadErr)
							messageContentBuilder.WriteString(fmt.Sprintf("[File Download Error: %s (%s) - %v]", p.URI, p.MimeType, downloadErr))
						} else {
							contentStr := string(content)
							snippetLen := 500
							if len(contentStr) > snippetLen {
								contentStr = contentStr[:snippetLen] + "..."
							}
							messageContentBuilder.WriteString(fmt.Sprintf("[File Content from %s (%s)]:\n%s\n[/File Content]", p.URI, p.MimeType, contentStr))
							contentFound = true
						}
					case "file":
						messageContentBuilder.WriteString(fmt.Sprintf("[File: %s (%s)]", p.URI, p.MimeType))
						contentFound = true
					case "data":
						dataContent, decodeErr := decodeDataURI(p.URI)
						if decodeErr != nil {
							log.Printf("[Task %s] Error decoding Data URI for FilePart %s: %v", taskID, p.URI, decodeErr)
							messageContentBuilder.WriteString(fmt.Sprintf("[Data URI Decode Error: %s - %v]", p.MimeType, decodeErr))
						} else {
							contentStr := string(dataContent)
							snippetLen := 500
							if len(contentStr) > snippetLen {
								contentStr = contentStr[:snippetLen] + "..."
							}
							messageContentBuilder.WriteString(fmt.Sprintf("[Data Content (%s)]:\n%s\n[/Data Content]", p.MimeType, contentStr))
							contentFound = true
						}
					default:
						// This case should ideally not be reached due to isValidPartURI check
						log.Printf("[Task %s] Warning: Unexpected URI scheme after validation: %s", taskID, parsedURI.Scheme)
						messageContentBuilder.WriteString(fmt.Sprintf("[Unexpected URI Scheme: %s]", parsedURI.Scheme))
					}

				case DataPart:
					// For DataPart, we might just include a placeholder or summary
					messageContentBuilder.WriteString(fmt.Sprintf("[Data: %s]", p.MimeType))
					contentFound = true
				default:
					log.Printf("[Task %s] Warning: Unrecognized part type %T", taskID, p)
					messageContentBuilder.WriteString(fmt.Sprintf("[Unknown Part Type: %T]", p))
				}
			}

			// Only add message if it has content
			if messageContentBuilder.Len() > 0 {
				llmMessages = append(llmMessages, llm.Message{
					Role:    string(msg.Role), // Convert Task MessageRole to LLM Message Role string
					Content: messageContentBuilder.String(),
				})
			}
		}
	}

	if !contentFound {
		// This case handles when no parts suitable for prompt were found at all
		return nil, false, fmt.Errorf("could not extract suitable prompt content from messages")
	}

	// The system message is already prepended if it existed.
	// The rest of the messages are added in their original order.
	// No further reordering is needed here.

	return llmMessages, true, nil
}
