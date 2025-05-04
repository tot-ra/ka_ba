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

// buildPromptFromInput constructs the LLM prompt string from task input messages.
func buildPromptFromInput(taskID string, inputMessages []Message) (prompt string, promptFound bool, err error) {
	var promptBuilder strings.Builder
	userMessageFound := false

	if len(inputMessages) == 0 {
		return "", false, nil // No input, no prompt
	}

	// First pass: Check for at least one user message
	for _, msg := range inputMessages {
		if msg.Role == RoleUser {
			userMessageFound = true
			break
		}
	}

	if !userMessageFound {
		return "", false, fmt.Errorf("input validation failed: no message with role '%s' found", RoleUser)
	}

	// Second pass: Build the prompt string
	for _, msg := range inputMessages {
		// Include messages from User, Assistant, and Tool roles
		if msg.Role == RoleUser || msg.Role == RoleAssistant || msg.Role == RoleTool {
			// Add a separator between messages
			if promptBuilder.Len() > 0 {
				promptBuilder.WriteString("\n\n---\n\n")
			}

			// For Assistant messages with tool_calls, include the tool_calls JSON
			if msg.Role == RoleAssistant && len(msg.ToolCalls) > 0 {
				promptBuilder.WriteString(fmt.Sprintf("[TOOL_CALLS]: %s", string(msg.ToolCalls)))
				promptFound = true // Consider tool calls as contributing to prompt content
			}

			// Include parts for all relevant roles
			for _, part := range msg.Parts {
				switch p := part.(type) {
				case TextPart:
					promptBuilder.WriteString(p.Text)
					promptFound = true
				case FilePart:
					parsedURI, ok := isValidPartURI(p.URI)
					if !ok {
						return "", false, fmt.Errorf("invalid or unsupported URI scheme in FilePart: %s", p.URI)
					}

					switch parsedURI.Scheme {
					case "http", "https":
						const maxDownloadSize = 1024 * 1024 // 1MB limit
						content, downloadErr := downloadHTTPContent(p.URI, maxDownloadSize)
						if downloadErr != nil {
							log.Printf("[Task %s] Error downloading FilePart content from %s: %v", taskID, p.URI, downloadErr)
							promptBuilder.WriteString(fmt.Sprintf("[File Download Error: %s (%s) - %v]", p.URI, p.MimeType, downloadErr))
							// Optionally return error here if download failure should halt processing
							// return "", false, fmt.Errorf("failed to download content for FilePart %s: %w", p.URI, downloadErr)
						} else {
							contentStr := string(content)
							snippetLen := 500
							if len(contentStr) > snippetLen {
								contentStr = contentStr[:snippetLen] + "..."
							}
							promptBuilder.WriteString(fmt.Sprintf("[File Content from %s (%s)]:\n%s\n[/File Content]", p.URI, p.MimeType, contentStr))
							promptFound = true
						}
					case "file":
						promptBuilder.WriteString(fmt.Sprintf("[File: %s (%s)]", p.URI, p.MimeType))
						promptFound = true
					case "data":
						dataContent, decodeErr := decodeDataURI(p.URI)
						if decodeErr != nil {
							log.Printf("[Task %s] Error decoding Data URI for FilePart %s: %v", taskID, p.URI, decodeErr)
							promptBuilder.WriteString(fmt.Sprintf("[Data URI Decode Error: %s - %v]", p.MimeType, decodeErr))
							// Optionally return error here if decode failure should halt processing
							// return "", false, fmt.Errorf("failed to decode data URI for FilePart %s: %w", p.URI, decodeErr)
						} else {
							contentStr := string(dataContent)
							snippetLen := 500
							if len(contentStr) > snippetLen {
								contentStr = contentStr[:snippetLen] + "..."
							}
							promptBuilder.WriteString(fmt.Sprintf("[Data Content (%s)]:\n%s\n[/Data Content]", p.MimeType, contentStr))
							promptFound = true
						}
					default:
						return "", false, fmt.Errorf("unexpected URI scheme after validation: %s", parsedURI.Scheme)
					}

				case DataPart:
					promptBuilder.WriteString(fmt.Sprintf("[Data: %s]", p.MimeType))
					promptFound = true
				default:
					promptBuilder.WriteString(fmt.Sprintf("[Unknown Part Type: %T]", p))
				}
			}
		}
	}

	if !promptFound {
		// This case handles when no parts suitable for prompt were found at all
		return "", false, fmt.Errorf("could not extract suitable prompt content from messages")
	}

	return promptBuilder.String(), true, nil
}
