import React, { useState, useRef } from 'react';

// Re-define TaskInput interface locally or import if shared
interface TaskInput {
  text: string;
  files: File[];
}

// Removed local Task interface definition - rely on prop type

interface TaskInputFormProps {
  taskInput: TaskInput;
  setTaskInput: React.Dispatch<React.SetStateAction<TaskInput>>;
  onSendTask: (e: React.FormEvent, input: TaskInput) => Promise<void>; // Function to call when sending a new task
  onSendInput: (input: TaskInput) => Promise<void>; // Function to call when submitting required input
  isLoading: boolean;
  // Assuming parent passes correct Task type based on GraphQL schema
  currentTask: { id: string; state: string; [key: string]: any } | null;
}

const TaskInputForm: React.FC<TaskInputFormProps> = ({
  taskInput,
  setTaskInput,
  onSendTask,
  onSendInput,
  isLoading,
  currentTask,
  taskInput: { text, files = [] }, // Provide a default empty array for files
}) => {
  const inputAreaRef = useRef<HTMLDivElement>(null);

  // Access top-level state property based on GraphQL schema
  const isInputRequired = currentTask?.state === 'INPUT_REQUIRED'; // Use uppercase enum value

  const handleInput = () => {
    if (inputAreaRef.current) {
      setTaskInput(prev => ({ ...prev, text: inputAreaRef.current?.innerText || '' }));
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // Prevent default behavior to allow drop
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault(); // Prevent default behavior
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const droppedFiles = Array.from(e.dataTransfer.files);
      setTaskInput(prev => ({ ...prev, files: [...prev.files, ...droppedFiles] }));
    }
  };

  const handleRemoveFile = (fileName: string) => {
    setTaskInput(prev => ({
      ...prev,
      files: prev.files.filter(file => file.name !== fileName),
    }));
  };

  // Note: The parent component and backend GraphQL mutation will need to be updated
  // to handle both 'text' and 'files' from the TaskInput interface.
  // The current onSendTask and onSendInput functions in the parent likely only expect
  // a single 'content' field.

  return (
    <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '4px' }}>
      <h3 style={{ marginTop: 0 }}>New Task</h3>
      <div
        ref={inputAreaRef}
        contentEditable
        onInput={handleInput}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        style={{
          minHeight: '100px',
          border: '1px dashed #ddd',
          padding: '10px',
          borderRadius: '4px',
          marginBottom: '10px',
          whiteSpace: 'pre-wrap', // Preserve whitespace and line breaks
          overflowWrap: 'break-word', // Break lines when they overflow
        }}
      >
        {/* Display text content is handled by contentEditable */}
      </div>

      {(taskInput?.files?.length ?? 0) > 0 && (
        <div style={{ marginBottom: '10px' }}>
          <h4>Dropped Files:</h4>
          <ul>
            {/* Use optional chaining when mapping over files */}
            {taskInput?.files?.map((file, index) => (
              <li key={index} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                {file.name} ({file.size} bytes)
                <button
                  onClick={() => handleRemoveFile(file.name)}
                  style={{ marginLeft: '10px', cursor: 'pointer', background: 'none', border: 'none', color: 'red' }}
                >
                  &times;
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Unified Button */}
      <button
        onClick={(e) => {
          console.log('Sending taskInput:', taskInput); // Added logging
          if (isInputRequired) {
            onSendInput(taskInput);
          } else {
            onSendTask(e, taskInput);
          }
        }} // Dynamically choose handler and pass taskInput
        disabled={isLoading || (!taskInput.text && (taskInput?.files?.length ?? 0) === 0)} // Disable if no text and no files
        style={{
          marginTop: '10px',
          padding: '10px 15px',
          backgroundColor: isInputRequired ? '#ffc107' : '#007bff', // Yellow for input, blue for new task
          color: isInputRequired ? 'black' : 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
          opacity: isLoading || (!taskInput.text && (taskInput?.files?.length ?? 0) === 0) ? 0.6 : 1,
        }}
      >
        {isLoading ? 'Sending...' : (isInputRequired ? 'Submit Input' : 'Create')} {/* Dynamic label */}
      </button>
    </div>
  );
};

export default TaskInputForm;
