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
	target       io.Writer
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
func buildPromptFromInput(taskID string, inputMessages []Message, agentSystemMessage string) ([]llm.Message, bool, error) {
	llmMessages := make([]llm.Message, 0, len(inputMessages)+1)
	contentFound := false

	// Add system message if provided
	if agentSystemMessage != "" {
		llmMessages = append(llmMessages, llm.Message{
			Role:    string(RoleSystem),
			Content: agentSystemMessage,
		})
		contentFound = true
	}

	// Handle empty input case
	if len(inputMessages) == 0 {
		if contentFound {
			return llmMessages, true, nil
		}
		return nil, false, nil
	}

	// Validate at least one user message exists
	if !hasUserMessage(inputMessages) {
		return nil, false, fmt.Errorf("input validation failed: no message with role '%s' found", RoleUser)
	}

	// Process all messages
	for _, msg := range inputMessages {
		if !isRelevantRole(msg.Role) {
			continue
		}

		content, msgContentFound := buildMessageContent(taskID, msg)
		if msgContentFound && content != "" {
			llmMessages = append(llmMessages, llm.Message{
				Role:    string(msg.Role),
				Content: content,
			})
			contentFound = true
		}
	}

	if !contentFound {
		return nil, false, fmt.Errorf("could not extract suitable prompt content from messages")
	}

	return llmMessages, true, nil
}

// hasUserMessage checks if there's at least one user message in the input
func hasUserMessage(messages []Message) bool {
	for _, msg := range messages {
		if msg.Role == RoleUser {
			return true
		}
	}
	return false
}

// isRelevantRole returns true if the message role should be included in the prompt
func isRelevantRole(role MessageRole) bool {
	return role == RoleUser || role == RoleAssistant || role == RoleTool
}

// buildMessageContent processes a single message and builds its content string
func buildMessageContent(taskID string, msg Message) (string, bool) {
	var messageContentBuilder strings.Builder
	contentFound := false

	for _, part := range msg.Parts {
		switch p := part.(type) {
		case TextPart:
			messageContentBuilder.WriteString(p.Text)
			contentFound = true
		case FilePart:
			contentFound = processFilePart(taskID, p, &messageContentBuilder) || contentFound
		case DataPart:
			messageContentBuilder.WriteString(fmt.Sprintf("[Data: %s]", p.MimeType))
			contentFound = true
		default:
			log.Printf("[Task %s] Warning: Unrecognized part type %T", taskID, p)
			messageContentBuilder.WriteString(fmt.Sprintf("[Unknown Part Type: %T]", p))
		}
	}

	return messageContentBuilder.String(), contentFound
}

// processFilePart handles the processing of file parts with different URI schemes
func processFilePart(taskID string, part FilePart, builder *strings.Builder) bool {
	parsedURI, ok := isValidPartURI(part.URI)
	if !ok {
		log.Printf("[Task %s] Warning: Invalid or unsupported URI scheme in FilePart: %s", taskID, part.URI)
		builder.WriteString(fmt.Sprintf("[Invalid File URI: %s]", part.URI))
		return false
	}

	switch parsedURI.Scheme {
	case "http", "https":
		return processHTTPFilePart(taskID, part, builder)
	case "file":
		builder.WriteString(fmt.Sprintf("[File: %s (%s)]", part.URI, part.MimeType))
		return true
	case "data":
		return processDataURIFilePart(taskID, part, builder)
	default:
		// This case should ideally not be reached due to isValidPartURI check
		log.Printf("[Task %s] Warning: Unexpected URI scheme after validation: %s", taskID, parsedURI.Scheme)
		builder.WriteString(fmt.Sprintf("[Unexpected URI Scheme: %s]", parsedURI.Scheme))
		return false
	}
}

// processHTTPFilePart handles HTTP/HTTPS file parts
func processHTTPFilePart(taskID string, part FilePart, builder *strings.Builder) bool {
	const maxDownloadSize = 1024 * 1024 // 1MB limit
	content, downloadErr := downloadHTTPContent(part.URI, maxDownloadSize)
	if downloadErr != nil {
		log.Printf("[Task %s] Error downloading FilePart content from %s: %v", taskID, part.URI, downloadErr)
		builder.WriteString(fmt.Sprintf("[File Download Error: %s (%s) - %v]", part.URI, part.MimeType, downloadErr))
		return false
	}

	contentStr := string(content)
	snippetLen := 500
	if len(contentStr) > snippetLen {
		contentStr = contentStr[:snippetLen] + "..."
	}
	builder.WriteString(fmt.Sprintf("[File Content from %s (%s)]:\n%s\n[/File Content]", part.URI, part.MimeType, contentStr))
	return true
}

// processDataURIFilePart handles data URI file parts
func processDataURIFilePart(taskID string, part FilePart, builder *strings.Builder) bool {
	dataContent, decodeErr := decodeDataURI(part.URI)
	if decodeErr != nil {
		log.Printf("[Task %s] Error decoding Data URI for FilePart %s: %v", taskID, part.URI, decodeErr)
		builder.WriteString(fmt.Sprintf("[Data URI Decode Error: %s - %v]", part.MimeType, decodeErr))
		return false
	}

	contentStr := string(dataContent)
	snippetLen := 500
	if len(contentStr) > snippetLen {
		contentStr = contentStr[:snippetLen] + "..."
	}
	builder.WriteString(fmt.Sprintf("[Data Content (%s)]:\n%s\n[/Data Content]", part.MimeType, contentStr))
	return true
}
