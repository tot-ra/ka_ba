import React, { useState } from 'react';
import axios from 'axios';
// Removed invalid import of backend type

// --- Frontend Type Definitions (Simplified from a2aClient) ---
// Define necessary types locally for the frontend component
interface TextPart {
  type: 'text';
  text: string;
  metadata?: any;
}

// Add other Part types (FilePart, DataPart) here if needed by the form
type Part = TextPart; // Simplified for now

interface Message {
  role: 'user' | 'agent';
  parts: Part[];
  metadata?: any;
}
// --- End Frontend Type Definitions ---


// Define the expected structure for the API request body
interface CreateTaskPayload {
  message: Message;
  agentId?: string; // Add optional agentId
  // Add other optional fields like sessionId, metadata if needed
}

// Define the expected structure for the API response
interface CreateTaskResponse {
  id: string;
  status: { state: string };
  assignedAgentId: string;
  // Add other fields returned by the API if necessary
}

// Define props for the component
interface TaskSubmitFormProps {
  agentId: string; // Require agentId
}

const TaskSubmitForm: React.FC<TaskSubmitFormProps> = ({ agentId }) => { // Destructure agentId from props
  const [prompt, setPrompt] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitStatus, setSubmitStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) {
      setSubmitStatus({ type: 'error', message: 'Prompt cannot be empty.' });
      return;
    }

    setIsSubmitting(true);
    setSubmitStatus(null);

    const payload: CreateTaskPayload = {
      message: {
        role: 'user',
        parts: [{ type: 'text', text: prompt }],
      },
      agentId: agentId, // Include the agentId in the payload
    };

    try {
      // Assuming the backend endpoint /api/tasks/create can handle the agentId
      const response = await axios.post<CreateTaskResponse>('/api/tasks/create', payload);

      if (response.status === 200 && response.data && response.data.id) {
        setSubmitStatus({
          type: 'success',
          message: `Task ${response.data.id} created and assigned to agent ${response.data.assignedAgentId}. Status: ${response.data.status.state}`,
        });
        setPrompt(''); // Clear prompt on success
      } else {
        // Handle cases where API returns 200 but data is unexpected
        console.error('Unexpected success response:', response);
        setSubmitStatus({ type: 'error', message: 'Received an unexpected response from the server.' });
      }
    } catch (error: any) {
      console.error('Error submitting task:', error);
      const errorMessage = error.response?.data?.error || error.message || 'An unknown error occurred.';
      setSubmitStatus({ type: 'error', message: `Error: ${errorMessage}` });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={{ marginTop: '20px', padding: '15px', border: '1px solid #eee', borderRadius: '4px' }}>
      <h3>Submit New Task</h3>
      <form onSubmit={handleSubmit}>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter task prompt..."
          rows={4}
          style={{ width: '100%', padding: '8px', marginBottom: '10px', borderRadius: '4px', border: '1px solid #ddd' }}
          disabled={isSubmitting}
        />
        <button
          type="submit"
          disabled={isSubmitting}
          style={{
            padding: '10px 15px',
            backgroundColor: isSubmitting ? '#6c757d' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer',
          }}
        >
          {isSubmitting ? 'Submitting...' : 'Submit Task'}
        </button>
      </form>
      {submitStatus && (
        <div style={{
          marginTop: '10px',
          padding: '10px',
          borderRadius: '4px',
          backgroundColor: submitStatus.type === 'success' ? '#d4edda' : '#f8d7da',
          color: submitStatus.type === 'success' ? '#155724' : '#721c24',
          border: `1px solid ${submitStatus.type === 'success' ? '#c3e6cb' : '#f5c6cb'}`,
        }}>
          {submitStatus.message}
        </div>
      )}
    </div>
  );
};

export default TaskSubmitForm;
