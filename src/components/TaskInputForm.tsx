import React from 'react';

// Re-define TaskInput interface locally or import if shared
interface TaskInput {
  type: 'text' | 'file' | 'data';
  content: string | File | any;
}

// Define Task interface partially for status check
interface Task {
  id: string;
  status: {
    state: 'submitted' | 'working' | 'input-required' | 'completed' | 'canceled' | 'failed' | 'unknown';
  };
  // other fields omitted for brevity
}

interface TaskInputFormProps {
  taskInput: TaskInput;
  setTaskInput: React.Dispatch<React.SetStateAction<TaskInput>>;
  onSendTask: (e: React.FormEvent) => Promise<void>; // Function to call when sending a new task
  onSendInput: () => Promise<void>; // Function to call when submitting required input
  isLoading: boolean;
  currentTask: Task | null; // Needed to show/hide the 'Submit Input' button
}

const TaskInputForm: React.FC<TaskInputFormProps> = ({
  taskInput,
  setTaskInput,
  onSendTask,
  onSendInput,
  isLoading,
  currentTask,
}) => {
  const isInputRequired = currentTask?.status.state === 'input-required';

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setTaskInput({ ...taskInput, content: e.target.value });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setTaskInput({ type: 'file', content: e.target.files[0] });
    } else {
      // Handle case where file selection is cancelled
      setTaskInput({ ...taskInput, content: '' });
    }
  };

  const handleDataTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setTaskInput({ type: e.target.value as 'text' | 'file' | 'data', content: '' }); // Reset content on type change
  };

  return (
    <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '4px' }}>
      <h3 style={{ marginTop: 0 }}>Submit Task / Provide Input</h3>
      <div style={{ marginBottom: '10px' }}>
        <label htmlFor="inputType" style={{ marginRight: '10px' }}>Input Type:</label>
        <select id="inputType" value={taskInput.type} onChange={handleDataTypeChange}>
          <option value="text">Text</option>
          <option value="file">File</option>
          <option value="data">Data (JSON)</option>
        </select>
      </div>
      {taskInput.type === 'text' && (
        <textarea
          placeholder="Enter task input..."
          value={taskInput.content as string}
          onChange={handleInputChange}
          rows={5}
          style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd', boxSizing: 'border-box' }}
        ></textarea>
      )}
      {taskInput.type === 'file' && (
        <input type="file" onChange={handleFileChange} style={{ width: '100%' }}/>
      )}
      {taskInput.type === 'data' && (
        <textarea
          placeholder="Enter JSON data..."
          value={taskInput.content as string}
          onChange={handleInputChange}
          rows={5}
          style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd', boxSizing: 'border-box' }}
        ></textarea>
      )}
      {/* Unified Button */}
      <button
        onClick={isInputRequired ? onSendInput : onSendTask} // Dynamically choose handler
        disabled={isLoading || !taskInput.content}
        style={{
          marginTop: '10px',
          padding: '10px 15px',
          backgroundColor: isInputRequired ? '#ffc107' : '#007bff', // Yellow for input, blue for new task
          color: isInputRequired ? 'black' : 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          opacity: isLoading || !taskInput.content ? 0.6 : 1,
        }}
      >
        {isLoading ? 'Sending...' : (isInputRequired ? 'Submit Input' : 'Submit New Task')} {/* Dynamic label */}
      </button>
      {/* Removed the separate conditional button */}
    </div>
  );
};

export default TaskInputForm;
