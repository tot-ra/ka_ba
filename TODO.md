# clarifai-agent TODO

This is the implementation checklist for building the Go-based agent runtime to comply with the A2A protocol and requirements.

## 1. Core Infrastructure
- [x] Set up Go project structure and module files (modularized, with llm package)
- [x] Implement CLI entrypoint with interactive and command modes (ai.go)
- [x] Add Makefile and ability to build the project. Run it to test if we have binary running on mac.
- [x] Add Dockerfile and container entrypoint scripts
- [x] Support configuration for LLM provider/model/API key (env/config/CLI)
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

## 4. Task Management
- [x] Define Task object model (states: submitted, working, input-required, completed, failed, canceled) - In `a2a/task.go`
- [x] Implement task lifecycle management and state transitions (Basic `SetState` in `InMemoryTaskStore`)
- [x] Implement persistent task log/history (Basic in-memory store `InMemoryTaskStore` added - non-persistent)
    - [x] Implement a file-based persistent TaskStore (`FileTaskStore`)
    - [x] Add unit tests for `FileTaskStore` (Covered basic CRUD, state, message, artifact add/get)
- [x] Support for input-required (pause/wait for user input) (Implemented via TaskExecutor and channels)

## 5. Message, Part, and Artifact Handling
- [x] Implement Message model (roles, parts) - In `a2a/task.go`
- [x] Support TextPart, FilePart, DataPart (JSON forms) - Structs defined in `a2a/task.go`
    - [x] Implemented custom JSON unmarshalling for polymorphic Parts in `Message`
    - [~] Handlers need logic to process non-TextPart inputs (e.g., download files from URI) (Basic file:// read and DataPart marshalling added to prompt extraction)
- [x] Implement Artifact model for outputs (Basic struct and storage in Task defined)
    - [x] Implement actual artifact creation during task processing (LLM output saved for send/sendSubscribe)

## 6. Streaming & Push Notifications
- [ ] Implement SSE streaming for long-running tasks
- [ ] Implement webhook push notifications for task updates

## 7. Tool Access Control

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
- [ ] Document how to configure and swap LLM backends
- [ ] (Future) Add support for additional LLM providers (OpenAI, Clarifai, Ollama, etc.)

**Current focus:**
- LM Studio is the default LLM backend (via OpenAI-compatible API)
- Implement robust streaming support in CLI
- Next: HTTP API (A2A endpoints), task management, agent card/self-description
- [ ] Integrate MCP and filesystem tools as plugins/modules
- [ ] Implement user-configurable tool access policies (allow/deny/ask)
- [ ] Audit logging for all tool invocations

## 8. Security & Containerization
- [ ] Enforce least-privilege defaults and sandboxing
- [ ] Respect Docker/container resource and access limits
- [ ] Implement healthcheck endpoint for orchestration

## 9. Observability & Testing
- [ ] Add structured logging and metrics
- [ ] Implement error handling and reporting
- [ ] Write unit and integration tests for all components
- [ ] Add conformance tests for A2A protocol compliance

## 10. Documentation
- [ ] Document all public APIs and CLI commands
- [ ] Provide usage examples in README and agent.json
- [ ] Document tool/plugin interface and extension points
