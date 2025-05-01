# ka AI agent TODO

This is the implementation checklist for building the Go-based agent runtime to comply with the A2A protocol and requirements.

## 0. BUGs
- [x] Running ./ka server does not start the server. It instead treats it as "server" argument that just runs CLI

## 1. Core Infrastructure
- [x] Set up Go project structure and module files (modularized, with llm package)
- [x] Implement CLI entrypoint with interactive and command modes (ai.go)
- [x] Add Makefile and ability to build the project. Run it to test if we have binary running on mac.
- [x] Add Dockerfile and container entrypoint scripts
- [x] Support configuration for LLM provider/model/API key (env/config/CLI)
  - [x] Add command-line flag for setting custom model (--model)
- [~] Unit tests covering core and critical functionality (Basic tests for TaskStore added in `a2a/task_test.go`)
- [x] Update README.md on the whole project vision and implementation
- [x] Re-run build and unit tests to verify project working
- [x] Cleanup code from all comments
- [x] Refactor: Split large files (>500 lines) into smaller ones

## 2. Agent Self-Description
- [x] Serve `/.well-known/agent.json` with agent metadata, capabilities, endpoint, and auth requirements (http.go)
- [x] Provide CLI command to output agent self-description (`--describe` flag added to ai.go)
- [x] (Optional) Expose in agent card which LLM(s) are used for transparency (Model name added dynamically)
- [x] Monitor current agent context length
- [x] Add ability to configure max context length after which current task summary should be generated and dumped into a new context

## 3. HTTP API (A2A Protocol)
- [x] Implement required HTTP endpoints (per a2a.json spec):
    - [x] `tasks/send` (Basic async implementation with placeholder LLM call)
    - [x] `tasks/sendSubscribe` (SSE streaming implemented)
    - [x] `tasks/pushNotification/set` (Placeholder improved: parses request, logs URL)
    - [x] `tasks/status` (Basic implementation)
    - [~] `tasks/artifact` (Handler implemented, retrieves from TaskStore, needs artifact creation logic)
    - [ ] Any other endpoints required by the spec
- [ ] Support authentication schemes as declared in agent.json
    - [ ] Implement JWT authentication for API endpoints
    - [ ] Add API key validation middleware
    - [ ] Update agent.json to reflect authentication requirements

## 4. Task Management
- [x] Define Task object model (states: submitted, working, input-required, completed, failed, canceled) - In `a2a/task.go`
- [x] Implement task lifecycle management and state transitions (Basic `SetState` in `InMemoryTaskStore`)
- [x] Implement persistent task log/history (Basic in-memory store `InMemoryTaskStore` added - non-persistent)
    - [x] Implement a file-based persistent TaskStore (`FileTaskStore`)
    - [x] Add unit tests for `FileTaskStore` (Covered basic CRUD, state, message, artifact add/get)
- [x] Support for input-required (pause/wait for user input) (Implemented via TaskExecutor and channels)
- [ ] Implement task cleanup/expiration policy
    - [ ] Add task TTL (time-to-live) configuration
    - [ ] Implement background task cleanup for expired tasks
    - [ ] Add task archiving functionality

## 5. Message, Part, and Artifact Handling
- [x] Implement Message model (roles, parts) - In `a2a/task.go`
- [x] Support TextPart, FilePart, DataPart (JSON forms) - Structs defined in `a2a/task.go`
    - [x] Implemented custom JSON unmarshalling for polymorphic Parts in `Message`
    - [~] Handlers need logic to process non-TextPart inputs (e.g., download files from URI) (Basic file:// read and DataPart marshalling added to prompt extraction)
- [x] Implement Artifact model for outputs (Basic struct and storage in Task defined)
    - [x] Implement actual artifact creation during task processing (LLM output saved for send/sendSubscribe)
- [ ] Enhance FilePart handling
    - [ ] Implement support for http:// URIs (download remote files)
    - [ ] Add support for data:// URIs (base64 encoded data)
    - [ ] Implement file size limits and validation
- [ ] Improve DataPart handling
    - [ ] Add structured data validation
    - [ ] Support for binary data encoding/decoding
    - [ ] Implement data size limits

## 6. Streaming & Push Notifications
- [x] Implement SSE streaming for long-running tasks (Basic implementation in TasksSendSubscribeHandler)
- [ ] Enhance SSE implementation
    - [ ] Add proper error handling for client disconnects
    - [ ] Implement backpressure handling
    - [ ] Add reconnection support with event IDs
- [ ] Implement webhook push notifications for task updates
    - [ ] Create notification payload structure
    - [ ] Implement retry logic for failed notifications
    - [ ] Add notification queue with background worker
    - [ ] Support for different notification events (state changes, new messages, etc.)
- [ ] Improve task resumption logic for `input-required` state
    - [ ] Add timeout for waiting for input
    - [ ] Implement graceful cancellation
    - [ ] Add support for default values if no input provided

## 7. Tool Access Control
- [ ] Integrate MCP and filesystem tools as plugins/modules
    - [ ] Design plugin architecture for tool integration
    - [ ] Implement filesystem access tools with proper sandboxing
    - [ ] Create MCP client for external tool access
- [ ] Implement user-configurable tool access policies
    - [ ] Add configuration for tool permissions (allow/deny/ask)
    - [ ] Implement permission checking middleware
    - [ ] Create UI for permission requests when in "ask" mode
- [ ] Audit logging for all tool invocations
    - [ ] Implement structured audit logs
    - [ ] Add configuration for audit log destination
    - [ ] Create tool usage analytics

## 8. LLM Integration
- [x] Define LLM abstraction/interface (provider, model, API key, endpoint, etc.)
- [x] Support OpenAI-compatible REST API (default implementation)
- [x] Support configuration via env vars/config file/CLI
- [x] Allow switching LLM providers without code changes
- [x] Pass system prompt and user message as context to LLM
- [x] **Implement streaming responses (OpenAI/LM Studio compatible)**
    - [x] Add CLI flag (`--stream`) and/or env var (`LLM_STREAM=true`) to enable streaming
    - [x] Set `Stream: true` in the request payload when enabled
    - [x] Read and parse streaming HTTP response (SSE or line-delimited JSON)
    - [x] Print assistant output tokens/chunks as they arrive
    - [x] Handle both LM Studio and OpenAI streaming formats
    - [x] Document streaming usage and error handling (Basic README update needed)
    - [ ] Test with both LM Studio and OpenAI endpoints (Manual testing required)
- [x] Provide error handling and logging for LLM calls (Basic error handling exists)
- [ ] Improve token counting implementation
    - [ ] Replace simple character-based estimation with proper tokenization
    - [ ] Add support for different tokenizers based on model
    - [ ] Implement token usage tracking and reporting
- [ ] Document how to configure and swap LLM backends
    - [ ] Create detailed configuration guide
    - [ ] Add examples for different LLM providers
    - [ ] Document environment variables and their effects
- [ ] Add support for additional LLM providers
    - [ ] Implement Clarifai API integration
    - [ ] Add support for Ollama
    - [ ] Support for Anthropic Claude API
    - [ ] Create adapter for Hugging Face Inference API

## 9. Security & Containerization
- [ ] Enforce least-privilege defaults and sandboxing
    - [ ] Implement file system access restrictions
    - [ ] Add network access controls
    - [ ] Create secure defaults configuration
- [ ] Respect Docker/container resource and access limits
    - [ ] Add resource usage monitoring
    - [ ] Implement graceful degradation under resource constraints
    - [ ] Support for container signals (SIGTERM, etc.)
- [ ] Implement healthcheck endpoint for orchestration
    - [ ] Create `/health` endpoint with component status
    - [ ] Add readiness and liveness probes
    - [ ] Implement proper shutdown handling

## 10. Observability & Testing
- [ ] Add structured logging and metrics
    - [ ] Implement structured logging with levels
    - [ ] Add Prometheus metrics endpoint
    - [ ] Create tracing for request flows
- [ ] Improve error handling and reporting
    - [ ] Standardize error types and codes
    - [ ] Implement proper error propagation
    - [ ] Add detailed error context for debugging
- [ ] Write unit and integration tests for all components
    - [ ] Increase test coverage for core components
    - [ ] Add integration tests for HTTP endpoints
    - [ ] Create mocks for external dependencies
- [ ] Add conformance tests for A2A protocol compliance
    - [ ] Implement test suite for A2A endpoints
    - [ ] Add validation for request/response formats
    - [ ] Create automated compliance checking

## 11. Documentation
- [ ] Document all public APIs and CLI commands
    - [ ] Create API reference documentation
    - [ ] Add CLI command reference
    - [ ] Document configuration options
- [ ] Provide usage examples in README and agent.json
    - [ ] Add examples for common use cases
    - [ ] Create tutorials for integration
    - [ ] Document best practices
- [ ] Document tool/plugin interface and extension points
    - [ ] Create developer guide for extending the agent
    - [ ] Document plugin architecture
    - [ ] Add examples for custom tool implementation

## 12. Performance Optimization
- [ ] Implement connection pooling for HTTP clients
- [ ] Add caching for frequently accessed resources
- [ ] Optimize JSON marshalling/unmarshalling
- [ ] Implement rate limiting for external API calls
- [ ] Profile and optimize memory usage

## 13. Error Handling and Resilience
- [ ] Implement circuit breakers for external dependencies
- [ ] Add retry logic with exponential backoff
- [ ] Improve error reporting and diagnostics
- [ ] Implement graceful degradation modes
- [ ] Add crash recovery mechanisms

**Current focus:**
- Improve token counting implementation with proper tokenization
- Implement webhook push notifications for task updates
- Enhance FilePart handling with support for http:// and data:// URIs
- Add structured logging and metrics for better observability
- Increase test coverage for core components
