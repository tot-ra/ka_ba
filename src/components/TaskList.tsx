import React, { useState, useEffect } from 'react';
import axios from 'axios'; // Import axios

// --- Interfaces matching GraphQL Schema ---
type TaskState = "SUBMITTED" | "WORKING" | "INPUT_REQUIRED" | "COMPLETED" | "FAILED" | "CANCELED";
type MessageRole = "SYSTEM" | "USER" | "ASSISTANT" | "TOOL";

// Using 'any' for parts to match JSONObject scalar for now
interface Message {
  role: MessageRole;
  parts: any[]; // Array of parts (simplified)
  toolCalls?: any; // Placeholder
  toolCallId?: string;
}

interface Artifact {
  id: string;
  type: string;
  filename?: string;
}

interface Task {
  id: string;
  state: TaskState;
  input?: Message[];
  output?: Message[];
  error?: string;
  createdAt: string; // ISO date string
  updatedAt: string; // ISO date string
  artifacts?: { [key: string]: Artifact }; // Map of artifact ID to Artifact
}

// Define a more detailed structure for task history if available
// Placeholder for now - might reuse Task interface fields
interface TaskHistory {
  messages: Array<{ role: string; content: string; parts?: any[]; timestamp: string }>; // Example structure
  artifacts: Array<{ name: string; type: string; uri: string }>; // Example structure
}


interface TaskListProps {
  agentId: string | null; // ID of the agent whose tasks we want to show
}

// Basic Modal Component (can be moved to a separate file later)
const Modal: React.FC<{ isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{
        backgroundColor: 'white', padding: '20px', borderRadius: '5px',
        minWidth: '300px', maxWidth: '80%', maxHeight: '80%', overflowY: 'auto'
      }}>
        <h2>{title}</h2>
        <button onClick={onClose} style={{ position: 'absolute', top: '10px', right: '10px' }}>Close</button>
        <div>{children}</div>
      </div>
    </div>
  );
};


const TaskList: React.FC<TaskListProps> = ({ agentId }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [taskHistory, setTaskHistory] = useState<TaskHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);


  useEffect(() => {
    if (!agentId) {
      setTasks([]); // Clear tasks if no agent is selected
      return;
    }

    const fetchTasks = async () => {
      setLoading(true);
      setError(null);
      console.log(`Fetching tasks for agent: ${agentId}`);
      try {
        const graphqlQuery = {
          query: `
            query ListTasks($agentId: ID!) {
              listTasks(agentId: $agentId) {
                id
                state
                input {
                  role
                  parts # Fetching parts as JSONObject
                }
                output {
                  role
                  parts
                }
                error
                createdAt
                updatedAt
                artifacts # Fetching artifacts map
              }
            }
          `,
          variables: { agentId },
        };

        const response = await axios.post('http://localhost:3000/graphql', graphqlQuery);

        if (response.data.errors) {
          // Handle GraphQL errors
          console.error("GraphQL errors:", response.data.errors);
          throw new Error(response.data.errors.map((e: any) => e.message).join(', '));
        }

        const data: Task[] = response.data.data.listTasks;

        // Basic validation
        if (!Array.isArray(data)) {
          console.error("Received non-array data from listTasks query:", data);
          throw new Error('Invalid data format received from server.');
        }

        console.log(`Received ${data.length} tasks.`);
        setTasks(data);

      } catch (err) {
        console.error("Error fetching tasks:", err);
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
        setTasks([]);
      } finally {
        setLoading(false);
      }
    };

    fetchTasks();
  }, [agentId]); // Re-fetch when agentId changes

  const handleViewHistory = async (task: Task) => {
    setSelectedTask(task);
    setIsModalOpen(true);
    setHistoryLoading(true);
    setHistoryError(null);
    setTaskHistory(null); // Clear previous history

    try {
      // TODO: Implement actual API call to fetch full task history
      console.log(`Fetching history for task ${task.id}...`);
      // const response = await fetch(`/api/agents/${agentId}/tasks/${task.id}/history`);
      // if (!response.ok) {
      //   throw new Error('Failed to fetch task history');
      // }
      // const historyData: TaskHistory = await response.json();

      // Placeholder data for now
      await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
      const historyData: TaskHistory = {
        messages: [
          { role: 'user', content: 'Initial prompt (placeholder)', timestamp: task.createdAt }, // Use createdAt
          { role: 'assistant', content: 'Assistant response (placeholder)', timestamp: task.updatedAt }, // Use updatedAt and static text
          // Add more placeholder messages if needed
        ],
        artifacts: [
          // Add placeholder artifacts if needed
          // { name: 'output.txt', type: 'text/plain', uri: 'data:text/plain;base64,SGVsbG8gV29ybGQ=' }
        ],
      };

      setTaskHistory(historyData);
    } catch (err) {
      console.error("Error fetching task history:", err);
      setHistoryError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setHistoryLoading(false);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setSelectedTask(null);
    setTaskHistory(null);
    setHistoryError(null);
  };


  if (!agentId) {
    return <div>Select an agent to view tasks.</div>;
  }

  if (loading) {
    return <div>Loading tasks...</div>;
  }

  if (error) {
    return <div style={{ color: 'red' }}>Error loading tasks: {error}</div>;
  }

  // Helper to get first text part from input messages
  const getFirstInputText = (task: Task): string => {
    if (task.input && task.input.length > 0) {
      const firstMessage = task.input[0];
      if (firstMessage.parts && firstMessage.parts.length > 0) {
        // Find the first part that looks like a text part
        const textPart = firstMessage.parts.find(p => typeof p === 'object' && p !== null && p.type === 'text' && typeof p.text === 'string');
        if (textPart) {
          return textPart.text.substring(0, 100) + (textPart.text.length > 100 ? '...' : ''); // Truncate long text
        }
      }
    }
    return 'N/A';
  };


  if (tasks.length === 0) {
    return <div>No tasks found for this agent.</div>;
  }

  return (
    <div>
      <h3>Tasks</h3>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {tasks.map(task => (
          <li key={task.id} style={{ border: '1px solid #ccc', marginBottom: '10px', padding: '10px', borderRadius: '4px' }}>
            <div><strong>ID:</strong> <code style={{ fontSize: '0.9em' }}>{task.id}</code></div>
            <div><strong>State:</strong> <span style={{ fontWeight: 'bold', color: task.state === 'FAILED' ? 'red' : (task.state === 'COMPLETED' ? 'green' : 'inherit') }}>{task.state}</span></div>
            <div><strong>Created:</strong> {new Date(task.createdAt).toLocaleString()}</div>
            <div><strong>Updated:</strong> {new Date(task.updatedAt).toLocaleString()}</div>
            <div><strong>Input:</strong> <i style={{ color: '#555' }}>{getFirstInputText(task)}</i></div>
            {task.error && <div style={{ color: 'red' }}><strong>Error:</strong> {task.error}</div>}
            {/* History button remains, but its functionality is still placeholder */}
            <button onClick={() => handleViewHistory(task)} style={{ marginTop: '5px' }}>
              View History (Placeholder)
            </button>
          </li>
        ))}
      </ul>

      <Modal isOpen={isModalOpen} onClose={closeModal} title={`History for Task: ${selectedTask?.id}`}>
        {historyLoading && <div>Loading history...</div>}
        {historyError && <div style={{ color: 'red' }}>Error: {historyError}</div>}
        {taskHistory && (
          <div>
            <h4>Messages</h4>
            {taskHistory.messages.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {taskHistory.messages.map((msg, index) => (
                  <li key={index} style={{ marginBottom: '10px', borderBottom: '1px dashed #eee', paddingBottom: '5px' }}>
                    <strong>{msg.role}</strong> ({new Date(msg.timestamp).toLocaleString()}):
                    <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '5px 0 0 10px' }}>{msg.content}</pre>
                    {/* TODO: Render parts if they exist */}
                  </li>
                ))}
              </ul>
            ) : (
              <div>No messages found.</div>
            )}

            <h4>Artifacts</h4>
            {taskHistory.artifacts.length > 0 ? (
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {taskHistory.artifacts.map((art, index) => (
                  <li key={index}>
                    {art.name} ({art.type}) - <a href={art.uri} target="_blank" rel="noopener noreferrer">View/Download</a>
                  </li>
                ))}
              </ul>
            ) : (
              <div>No artifacts found.</div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default TaskList;
