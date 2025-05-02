// Shared type definitions for Tasks, Messages, etc.

export type TaskState = "SUBMITTED" | "WORKING" | "INPUT_REQUIRED" | "COMPLETED" | "FAILED" | "CANCELED";
export type MessageRole = "SYSTEM" | "USER" | "ASSISTANT" | "TOOL";

// Using 'any' for parts to match JSONObject scalar for now
// TODO: Define Part types more specifically if needed
export interface Message {
  role: MessageRole;
  parts: any[]; // Array of parts (simplified)
  toolCalls?: any; // Placeholder
  toolCallId?: string;
}

export interface Artifact {
  id: string; // Assuming Artifacts map key is the ID
  type: string;
  filename?: string;
  // Add other fields if needed based on actual usage or GraphQL schema
}

// This Task interface should align with the data returned by GraphQL queries (listTasks, createTask)
// and used by both AgentInteraction and TaskList.
export interface Task {
  id: string;
  state: TaskState;
  input?: Message[];
  output?: Message[];
  error?: string;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  artifacts?: { [key: string]: Artifact }; // Map of artifact ID to Artifact (as fetched by listTasks)
  // Add other potential fields if needed by components, ensuring consistency with GraphQL schema
  sessionId?: string | null;
  metadata?: any;
  // Note: Removed nested 'status' and 'history' if 'state', 'input', 'output' cover the needs
}

// Define TaskHistory separately for the modal view if its structure differs significantly
export interface TaskHistory {
    messages: Array<{ role: string; content: string; parts?: any[]; timestamp: string }>;
    artifacts: Array<{ name: string; type: string; uri: string }>; // Example structure from TaskList modal
}

// GraphQL Input Types (used in AgentInteraction mutation variables)
export interface InputPart {
  type: string;
  content: any; // Matches JSONObject scalar
  metadata?: any;
}

export interface InputMessage {
  role: MessageRole; // Use shared MessageRole
  parts: InputPart[];
  metadata?: any;
}

// Interface for the TaskInputForm state (can stay local or be shared)
export interface TaskInputState {
  type: 'text' | 'file' | 'data';
  content: string | File | any;
}
