package a2a

// This file previously contained various HTTP handlers for the A2A protocol.
// They have been split into more specific files:
// - handlers_task.go: Core task management (send, status, input, list)
// - handlers_sse.go: Server-Sent Events implementation and sendSubscribe handler
// - handlers_misc.go: Artifact retrieval and push notification handlers
