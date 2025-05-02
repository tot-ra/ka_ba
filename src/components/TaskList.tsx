import React, { useState, useEffect } from 'react';

interface Task {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastMessage: string; // Or a more complex message object
  // Add potentially more fields if needed for history view trigger
}

// Define a more detailed structure for task history if available
// Placeholder for now
interface TaskHistory {
  messages: Array<{ role: string; content: string; parts?: any[]; timestamp: string }>;
  artifacts: Array<{ name: string; type: string; uri: string }>;
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
      try {
        // TODO: Replace with actual API call to the 'ba' backend
        // Call the actual backend API endpoint
        const response = await fetch(`/api/agents/${agentId}/tasks`);
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ message: 'Failed to fetch tasks and parse error response' }));
          throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
        }
        const data: Task[] = await response.json(); // Assuming the backend returns Task[] directly

        // Validate the structure of the received data (basic check)
        if (!Array.isArray(data)) {
          console.error("Received non-array data from task list endpoint:", data);
          throw new Error('Invalid data format received from server.');
        }
        // Optional: Add more detailed validation for each task object if needed

        setTasks(data);

      } catch (err) {
        console.error("Error fetching tasks:", err); // Log the actual error
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
          { role: 'user', content: 'Initial prompt', timestamp: new Date().toISOString() },
          { role: 'assistant', content: task.lastMessage, timestamp: task.updatedAt },
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

  if (tasks.length === 0) {
    return <div>No tasks found for this agent.</div>;
  }

  return (
    <div>
      <h3>Tasks</h3>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {tasks.map(task => (
          <li key={task.id} style={{ border: '1px solid #ccc', marginBottom: '10px', padding: '10px' }}>
            <div><strong>ID:</strong> {task.id}</div>
            <div><strong>Status:</strong> {task.status}</div>
            <div><strong>Last Update:</strong> {new Date(task.updatedAt).toLocaleString()}</div>
            <div><strong>Last Message:</strong> {task.lastMessage}</div>
            {/* Removed TODO comment here */}
            <button onClick={() => handleViewHistory(task)} style={{ marginTop: '5px' }}>
              View History
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
