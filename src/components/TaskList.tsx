import React, { useState } from 'react'; // Removed useEffect
// Import shared types needed by this component
import { Task, TaskHistory } from '../types';

// --- Removed local type definitions ---
// type TaskState = ...
// type MessageRole = ...
// interface Message { ... }
// interface Artifact { ... }
// interface Task { ... }
// interface TaskHistory { ... }


interface TaskListProps {
  agentId: string | null; // Still needed to know *which* agent's tasks are shown
  tasks: Task[]; // Receive tasks as a prop
  loading: boolean; // Receive loading state as a prop
  error: string | null; // Receive error state as a prop
  onDeleteTask: (taskId: string) => void; // Callback to delete a task
  // onRefresh?: () => void; // Optional prop for manual refresh
}

// Basic Modal Component (can be moved to a separate file later)
// ... (Modal component remains the same) ...
const Modal: React.FC<{ isOpen: boolean; onClose: () => void; title: string; children: React.ReactNode }> = ({ isOpen, onClose, title, children }) => {
  if (!isOpen) return null;

  return (
    // Modal backdrop
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex',
      justifyContent: 'flex-end', // Align modal to the right
      zIndex: 1000
    }}>
      {/* Modal content */}
      <div style={{
        backgroundColor: 'white',
        width: '70vw', // 70% of viewport width
        height: '100vh', // Full viewport height
        overflowY: 'auto', // Allow scrolling within the modal
        display: 'flex',
        flexDirection: 'column', // Stack elements vertically
        padding: '20px', // Add padding inside
        boxSizing: 'border-box', // Include padding in width/height calculation
      }}>
        <h2>{title}</h2>
        {/* Ensure children container allows scrolling if needed */}
        <div style={{ flexGrow: 1, overflowY: 'auto' }}> {/* Allow this div to grow and scroll */}
          {children}
        </div>

        <button
          onClick={onClose}
          style={{
            alignSelf: 'flex-start', // Position button at the start (top-left within flex container)
            marginBottom: '15px', // Space below the button
            padding: '8px 15px',
            backgroundColor: 'black',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '0.9em',
            fontWeight: 'bold',
          }}
        >
          Back
        </button>
      </div>
    </div>
  );
};


// Destructure props including tasks, loading, error, and onDeleteTask
const TaskList: React.FC<TaskListProps> = ({ agentId, tasks, loading, error, onDeleteTask }) => {
  // Removed internal state for tasks, loading, error

  // Keep state related to the modal/history view
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [taskHistory, setTaskHistory] = useState<TaskHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  // Removed useEffect hook for fetching tasks

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
    // Use loading/error props passed down from parent
    return <div>Select an agent to view tasks.</div>;
  }

  // Use the loading and error props passed down from AgentInteraction
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

  // Helper to calculate duration
  const getDurationInSeconds = (start: string, end: string): string => {
    try {
      const startDate = new Date(start);
      const endDate = new Date(end);
      if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return 'N/A';
      }
      const durationMs = endDate.getTime() - startDate.getTime();
      return (durationMs / 1000).toFixed(2); // Duration in seconds with 2 decimal places
    } catch (e) {
      console.error("Error calculating duration:", e);
      return 'N/A';
    }
  };

  return (
    <div>
      <h3>Tasks</h3>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {tasks.map(task => (
          <li key={task.id} style={{ border: '1px solid #ccc', marginBottom: '10px', padding: '10px', borderRadius: '4px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            {/* Left Section */}
            <div style={{ flexGrow: 1, marginRight: '15px' }}>
              {/* Input Text Link */}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); handleViewHistory(task); }}
                style={{ marginTop: '5px', display: 'block', cursor: 'pointer', textDecoration: 'underline', color: '#007bff', wordBreak: 'break-word' }}
                title="View History" // Add a title for accessibility/hover
              >
                {getFirstInputText(task)}
              </a>
              {/* Duration */}
              <div style={{ fontSize: '0.8em', color: '#666', marginTop: '3px' }}>
                Duration: {getDurationInSeconds(task.createdAt, task.updatedAt)}s
              </div>
              <div style={{ fontSize: '0.8em', color: '#666', marginTop: '3px' }}>ID: <code style={{ fontSize: '1em' }}>{task.id}</code></div>
            </div>

            {/* Middle Section (Buttons) */}

            <div style={{ textAlign: 'right', flexShrink: 0, minWidth: '150px' }}> {/* Added minWidth for better alignment */}
              <div>
                {task.error && <div style={{ color: 'red', marginTop: '5px' }}><strong>Error:</strong> {task.error}</div>}
                <strong>State:</strong> <span style={{ fontWeight: 'bold', color: task.state === 'FAILED' ? 'red' : (task.state === 'COMPLETED' ? 'green' : 'inherit') }}>{task.state}</span>
              </div>
              <div style={{ fontSize: '0.8em', color: '#666', marginTop: '3px' }}>Updated: {new Date(task.updatedAt).toLocaleString()}</div>

              
            </div>


            {/* Right Section */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: '10px', marginRight: '10px' }}>
              <button
                onClick={() => console.log(`Cancel clicked for task ${task.id}`)}
                style={{ padding: '3px 8px', fontSize: '0.8em', marginBottom: '5px', cursor: 'pointer' }}
                title="Cancel Task (Placeholder)"
              >
                Cancel
              </button>
              <button
                onClick={() => console.log(`Duplicate clicked for task ${task.id}`)}
                style={{ padding: '3px 8px', fontSize: '0.8em', cursor: 'pointer' }}
                title="Duplicate Task (Placeholder)"
              >
                Duplicate
              </button>
              {/* Delete Button */}
              <button
                onClick={() => {
                  if (window.confirm(`Are you sure you want to delete task ${task.id}?`)) {
                    onDeleteTask(task.id); // Use destructured prop directly
                  }
                }}
                style={{ padding: '3px 8px', fontSize: '0.8em', cursor: 'pointer', color: 'red', marginTop: '5px' }}
                title="Delete Task"
              >
                Delete
              </button>
            </div>
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
