import React from 'react'; // Removed useState, useEffect
// Import shared types needed by this component
import { Task } from '../types'; // Removed TaskHistory

interface TaskListProps {
  agentId: string | null; // Still needed to know *which* agent's tasks are shown
  tasks: Task[]; // Receive tasks as a prop
  loading: boolean; // Receive loading state as a prop
  error: string | null; // Receive error state as a prop
  onDeleteTask: (taskId: string) => void; // Callback to delete a task
  onViewTaskDetails: (task: Task) => void; // New callback to view task details in a modal
  onDuplicateTask: (agentId: string, taskId: string) => void; // Callback to duplicate a task
  // onRefresh?: () => void; // Optional prop for manual refresh
}

// Removed Modal component definition

// Destructure props including tasks, loading, error, onDeleteTask, onViewTaskDetails, and onDuplicateTask
const TaskList: React.FC<TaskListProps> = ({ agentId, tasks, loading, error, onDeleteTask, onViewTaskDetails, onDuplicateTask }) => {
  // Removed all state related to modal/history view
  // Removed useEffect hook for fetching tasks
  // Removed handleViewHistory and closeModal functions

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
        // Need to cast p to any because parts is [JSONObject!]!
        const textPart = firstMessage.parts.find((p: any) => typeof p === 'object' && p !== null && p.type === 'text' && typeof p.text === 'string');
        if (textPart) {
          // Cast textPart to the expected structure
          return (textPart as any).text.substring(0, 100) + ((textPart as any).text.length > 100 ? '...' : ''); // Truncate long text
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
            {/* State Indicator */}
            <div style={{ marginRight: '10px', marginTop:'10px', fontSize: '1.2em' }}>
              {task.state === 'SUBMITTED' && '⏳'} {/* Loader indicator */}
              {task.state === 'INPUT_REQUIRED' && '🟡'} {/* Question emoji */}
              {task.state === 'FAILED' && '🛑'} {/* Question emoji */}
              {task.state === 'COMPLETED' && '✅'} {/* Green check emoji */}
            </div>
            {/* Left Section */}
            <div style={{ flexGrow: 1, marginRight: '15px' }}>
              {/* Input Text Link - Now calls onViewTaskDetails */}
              <a
                href="#"
                onClick={(e) => { e.preventDefault(); onViewTaskDetails(task); }}
                style={{ marginTop: '5px', display: 'block', cursor: 'pointer', textDecoration: 'underline', color: '#007bff', wordBreak: 'break-word' }}
                title="View Details" // Updated title
              >
                {getFirstInputText(task)}
              </a>
              {/* Duration */}
              <div style={{ fontSize: '0.8em', color: '#666', marginTop: '3px' }}>
                Duration: {getDurationInSeconds(task.createdAt, task.updatedAt)}s
              </div>
              
            </div>

            {/* Middle Section (Buttons) */}

            <div style={{ textAlign: 'right', flexShrink: 0, minWidth: '150px' }}> {/* Added minWidth for better alignment */}
              <div>
                {task.error && <div style={{ color: 'red', marginTop: '5px' }}><strong>Error:</strong> {task.error}</div>}
                {/* <strong>State:</strong> <span style={{ fontWeight: 'bold', color: task.state === 'FAILED' ? 'red' : (task.state === 'COMPLETED' ? 'green' : 'inherit') }}>{task.state}</span> */}
              </div>
              <div style={{ fontSize: '0.8em', color: '#666', marginTop: '3px' }}>Updated: {new Date(task.updatedAt).toLocaleString()}</div>
              <div style={{ fontSize: '0.8em', color: '#666', marginTop: '3px' }}>ID: <code style={{ fontSize: '1em' }}>{task.id}</code></div>

            </div>


            {/* Right Section */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: '10px', marginRight: '10px' }}>
              <button
                onClick={() => onDuplicateTask(agentId!, task.id)} // Call the prop with agentId and taskId
                style={{ padding: '3px 8px', fontSize: '0.8em', cursor: 'pointer' }}
                title="Duplicate Task" // Updated title
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

      {/* Modal component removed - will be handled by parent */}
    </div>
  );
};

export default TaskList;
