import React, { useState, useEffect } from 'react';

interface Task {
  id: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  lastMessage: string; // Or a more complex message object
}

interface TaskListProps {
  agentId: string | null; // ID of the agent whose tasks we want to show
}

const TaskList: React.FC<TaskListProps> = ({ agentId }) => {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

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
        // Example: const response = await fetch(`/api/agents/${agentId}/tasks`);
        // if (!response.ok) {
        //   throw new Error('Failed to fetch tasks');
        // }
        // const data = await response.json();
        // setTasks(data);

        // Placeholder data for now
        await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
        const mockTasks: Task[] = [
          { id: 'task-123', status: 'completed', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastMessage: 'Generated report.' },
          { id: 'task-456', status: 'working', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastMessage: 'Analyzing data...' },
          { id: 'task-789', status: 'input-required', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), lastMessage: 'Need clarification on X.' },
        ];
        setTasks(mockTasks);

      } catch (err) {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
        setTasks([]);
      } finally {
        setLoading(false);
      }
    };

    fetchTasks();
  }, [agentId]); // Re-fetch when agentId changes

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
            {/* TODO: Add button/link to view full task details/history */}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default TaskList;
