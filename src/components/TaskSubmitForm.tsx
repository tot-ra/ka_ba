import React, { useState } from 'react';
// Removed direct axios import, now handled by utility
import { sendGraphQLRequest } from '../utils/graphqlClient'; // Import the utility function

// --- Frontend Type Definitions for GraphQL ---
// Matches InputPart structure (simplified content)
interface InputPart {
  type: 'text'; // Assuming only text for now
  content: { text: string }; // Content is an object containing the text
  metadata?: any;
}

// Matches InputMessage structure
interface InputMessage {
  role: 'USER' | 'AGENT' | 'SYSTEM' | 'TOOL'; // Align with GraphQL MessageRole enum
  parts: InputPart[];
  metadata?: any;
}

// Matches the structure of the Task type returned by the GraphQL mutation
interface GraphQLTaskResponse {
  id: string;
  state: string; // Assuming TaskState enum maps to string
  // Add other fields from the Task type if needed (e.g., createdAt)
}

// Matches the overall GraphQL response structure for the createTask mutation
interface GraphQLCreateTaskResponse {
  data?: {
    createTask: GraphQLTaskResponse;
  };
  errors?: Array<{ message: string; extensions?: { code?: string } }>; // Standard GraphQL error structure
}
// --- End Frontend Type Definitions ---

// Define props for the component
interface TaskSubmitFormProps {
  agentId: string; // Require agentId
}

const TaskSubmitForm: React.FC<TaskSubmitFormProps> = ({ agentId }) => {
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

    // Construct the GraphQL mutation query string
    const mutation = `
      mutation CreateTask($agentId: ID, $message: InputMessage!) {
        createTask(agentId: $agentId, message: $message) {
          id
          state
          # Add other fields you want returned here, e.g., createdAt
        }
      }
    `;

    // Construct the variables object
    const variables = {
      agentId: agentId, // Use the agentId passed via props
      message: {
        role: 'USER', // CORRECTED: Use uppercase enum value
        parts: [
          {
            type: 'text', // Assuming only text parts for now
            content: { text: prompt }, // Structure matches InputPart
          },
        ],
      } as InputMessage, // Type assertion
    };

    try {
      // Use the utility function to send the request
      // Specify the expected shape of the data part of the response
      const response = await sendGraphQLRequest<{ createTask: GraphQLTaskResponse }>(mutation, variables);

      // Check for GraphQL errors returned in the response body
      if (response.errors) {
        console.error('GraphQL errors:', response.errors);
        const errorMessages = response.errors.map(err => err.message).join('; ');
        setSubmitStatus({ type: 'error', message: `GraphQL Error: ${errorMessages}` });
      } else if (response.data?.createTask) {
        // Success case
        const createdTask = response.data.createTask;
        setSubmitStatus({
          type: 'success',
          message: `Task ${createdTask.id} created and submitted to agent ${agentId}. Initial state: ${createdTask.state}`,
        });
        setPrompt(''); // Clear prompt on success
      } else {
        // Handle unexpected response structure (no errors, no data.data)
        console.error('Unexpected GraphQL response structure:', response);
        setSubmitStatus({ type: 'error', message: 'Received an unexpected response structure from the server.' });
      }
    } catch (error: any) {
      // Handle errors thrown by sendGraphQLRequest (network, non-2xx status, or extracted GraphQL errors)
      console.error('Error submitting task via GraphQL utility:', error);
      // The utility function already formats the error message
      setSubmitStatus({ type: 'error', message: error.message });
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
