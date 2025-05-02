import React, { useState, useEffect, useCallback } from 'react'; // Added useEffect, useCallback

import { useAgent } from '../contexts/AgentContext';
import AgentLogs from '../components/AgentLogs';
import TaskInputForm from '../components/TaskInputForm';
import TaskDetails from '../components/TaskDetails';
import { gql } from '@apollo/client'; // Import gql if not already (needed for defining mutation)
import TaskList from '../components/TaskList';
import { sendGraphQLRequest } from '../utils/graphqlClient'; // Import the utility function
// Import shared types
import { Task, Artifact, TaskInputState as TaskInput, InputMessage, InputPart } from '../types';

// --- Removed local type definitions ---
// interface InputPart { ... }
// interface InputMessage { ... }
// type TaskState = ...
// interface Agent { ... } // Keep Agent if not defined globally
// interface Message { ... }
// interface TaskStatus { ... }
// interface Artifact { ... }
// interface Task { ... }
// interface TaskInput { ... }

// Keep Agent definition if it's specific to this component's needs or not in types.ts
interface Agent {
  id: string;
  url: string;
  name?: string;
  description?: string;
}


const AgentInteraction: React.FC = () => {
  const { selectedAgentId } = useAgent();

  // State managed by AgentInteraction
  const [taskInput, setTaskInput] = useState<TaskInput>({ type: 'text', content: '' }); // State for the form, passed down
  const [currentTask, setCurrentTask] = useState<Task | null>(null); // Details of the *last created/interacted* task
  const [streamingOutput, setStreamingOutput] = useState(''); // Keep for TaskDetails
  const [artifacts, setArtifacts] = useState<Artifact[]>([]); // Keep for TaskDetails
  const [isLoading, setIsLoading] = useState(false); // Loading state for mutations (create/input)
  const [error, setError] = useState<string | null>(null); // Error state for mutations
  const [activeTab, setActiveTab] = useState<'logs' | 'tasks'>('tasks'); // State for tabs

  // State for the Task List
  const [tasks, setTasks] = useState<Task[]>([]);
  const [listLoading, setListLoading] = useState<boolean>(false);
  const [listError, setListError] = useState<string | null>(null);

  // --- GraphQL Mutation Definition ---
  const DELETE_TASK_MUTATION = `
    mutation DeleteTask($agentId: ID!, $taskId: ID!) {
      deleteTask(agentId: $agentId, taskId: $taskId)
    }
  `;

  // Function to fetch tasks
  const fetchTasks = useCallback(async () => {
    if (!selectedAgentId) {
      setTasks([]);
      setListError(null);
      return;
    }
    setListLoading(true);
    setListError(null);
    console.log(`[AgentInteraction] Fetching tasks for agent: ${selectedAgentId}`);
    try {
      const graphqlQuery = {
        query: `
          query ListTasks($agentId: ID!) {
            listTasks(agentId: $agentId) {
              # Match fields needed by TaskList component
              id
              state
              input { role parts } # Simplified parts for list view
              output { role parts } # Simplified parts for list view
              error
              createdAt
              updatedAt
              # artifacts # Maybe omit artifacts from list view for performance?
            }
          }
        `,
        variables: { agentId: selectedAgentId },
      };
      const response = await sendGraphQLRequest<{ listTasks: Task[] }>(graphqlQuery.query, graphqlQuery.variables);

      if (response.errors) {
        console.error("[AgentInteraction] GraphQL errors fetching list:", response.errors);
        throw new Error(response.errors.map((e: any) => e.message).join(', '));
      }
      const data = response.data?.listTasks;
      if (!data || !Array.isArray(data)) {
        console.error("[AgentInteraction] Received invalid or missing data from listTasks query:", response);
        throw new Error('Invalid data format received from server.');
      }
      console.log(`[AgentInteraction] Received ${data.length} tasks.`);
      setTasks(data);
      // Ensure this log is present
      console.log('[AgentInteraction fetchTasks] Tasks state updated:', data);
    } catch (err: any) {
      console.error("[AgentInteraction] Error fetching tasks:", err);
      setListError(err.message);
      setTasks([]);
    } finally {
      setListLoading(false);
    }
  }, [selectedAgentId]); // Dependency: refetch if agent changes

  // Fetch tasks initially and when agent changes
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]); // fetchTasks is stable due to useCallback and selectedAgentId dependency

  // --- Delete Task Handler ---
  const handleDeleteTask = async (taskId: string) => {
    if (!selectedAgentId) {
      setError('Cannot delete task: No agent selected.');
      return;
    }

    console.log(`[AgentInteraction] Attempting to delete task ${taskId} for agent ${selectedAgentId}`);
    setIsLoading(true); // Reuse main loading state for simplicity
    setError(null);

    try {
      const variables = { agentId: selectedAgentId, taskId };
      const response = await sendGraphQLRequest<{ deleteTask: boolean }>(DELETE_TASK_MUTATION, variables);

      if (response.errors) {
        console.error(`[AgentInteraction] GraphQL errors deleting task ${taskId}:`, response.errors);
        throw new Error(response.errors.map((e: any) => e.message).join(', '));
      }

      if (response.data?.deleteTask === true) {
        console.log(`[AgentInteraction] Successfully deleted task ${taskId}. Refetching list...`);
        await fetchTasks(); // Refetch the task list to update the UI
      } else {
        console.warn(`[AgentInteraction] Delete mutation for task ${taskId} did not return true. Response:`, response);
        setError(`Failed to delete task ${taskId}. Agent might have failed or task already deleted.`);
      }
    } catch (err: any) {
      console.error(`[AgentInteraction] Error deleting task ${taskId}:`, err);
      setError(`Failed to delete task: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  // Handlers that remain in AgentInteraction
  const handleSendTask = async (e: React.FormEvent) => {
    e.preventDefault();
    // Clear previous logs when starting a new task? Maybe not, keep context? Let's keep them for now.
    // setCombinedLogs([]); // Decide if logs should clear on new task
    if (!selectedAgentId) {
      setError('No agent selected.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setStreamingOutput('');
    setArtifacts([]);
    setCurrentTask(null); // Clear previous task details

    // --- Start GraphQL Mutation Logic ---
    const mutation = `
      mutation CreateTask($agentId: ID, $message: InputMessage!) {
        createTask(agentId: $agentId, message: $message) {
          # Request all fields defined in the Task type in schema.graphql
          id
          state
          input { role parts toolCalls toolCallId }
          output { role parts toolCalls toolCallId }
          error
          createdAt
          updatedAt
          artifacts
        }
      }
    `;

    // Construct the message parts based on taskInput state
    let parts: InputPart[] = [];
    try {
      if (taskInput.type === 'text') {
        if (!taskInput.content || typeof taskInput.content !== 'string' || !taskInput.content.trim()) {
           setError('Text input cannot be empty.');
           setIsLoading(false);
           return;
        }
        parts.push({ type: 'text', content: { text: taskInput.content } });
      } else if (taskInput.type === 'file') {
        // TODO: File handling needs proper implementation (upload/URI)
        const file = taskInput.content as File;
        if (!file) {
           setError('No file selected.');
           setIsLoading(false);
           return;
        }
        console.warn('File part creation not fully implemented. Sending placeholder.');
        parts.push({ type: 'text', content: { text: `File: ${file.name} (upload not implemented)` } });
        // Example for future file handling (replace placeholder):
        // const fileData = await readFileAsBase64(file); // Need utility function
        // parts.push({ type: 'file', content: { name: file.name, mimeType: file.type, bytes: fileData } });
      } else if (taskInput.type === 'data') {
        if (!taskInput.content || typeof taskInput.content !== 'string' || !taskInput.content.trim()) {
           setError('JSON data cannot be empty.');
           setIsLoading(false);
           return;
        }
        try {
          const jsonData = JSON.parse(taskInput.content);
          parts.push({ type: 'data', content: jsonData }); // Send parsed JSON object
        } catch (jsonError: any) {
          setError(`Invalid JSON data: ${jsonError.message}`);
          setIsLoading(false);
          return;
        }
      }
    } catch (prepError: any) {
       setError(`Error preparing task input: ${prepError.message}`);
       setIsLoading(false);
       return;
    }


    // Construct the variables object
    const variables = {
      agentId: selectedAgentId,
      message: {
        role: 'USER', // Assuming tasks always start with USER role
        parts: parts,
      } as InputMessage,
    };

    try {
      // Use the utility function to send the request
      // Specify the expected shape of the data part of the response (Task)
      const response = await sendGraphQLRequest<{ createTask: Task }>(mutation, variables);

      // Check for GraphQL errors returned in the response body
      if (response.errors) {
        console.error('GraphQL errors:', response.errors);
        const errorMessages = response.errors.map(err => err.message).join('; ');
        setError(`GraphQL Error: ${errorMessages}`);
      } else if (response.data?.createTask) {
        // Success case
        const createdTask = response.data.createTask;
        setCurrentTask(createdTask); // Update the *current* task state (for details view)
        console.log('Task created:', createdTask);
        setError(null); // Clear previous errors
        // --- ADDED: Refetch the task list ---
        await fetchTasks();
        // Optionally clear the input form:
        // setTaskInput({ type: 'text', content: '' });
      } else {
        // Handle unexpected response structure
        console.error('[GraphQL createTask] Unexpected GraphQL response structure:', response);
        setError('Received an unexpected response structure from the server.');
      }
    } catch (error: any) {
      // Handle errors thrown by sendGraphQLRequest (network, non-2xx status, etc.)
      console.error('Error submitting task via GraphQL utility:', error);
      setError(`Network or Server Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
    // --- End GraphQL Mutation Logic ---
  };

  const handleInputRequired = async () => {
     // Use top-level state from the shared Task type
     if (!currentTask || currentTask.state !== 'INPUT_REQUIRED') return; // Changed 'input-required' to uppercase enum

     setIsLoading(true);
     setError(null);
     setError("Sending input not implemented yet.");
     setIsLoading(false);
  };

  const fetchArtifacts = async (taskId: string) => {
     if (!selectedAgentId) return;
     // TODO: Replace with GraphQL query if artifacts are exposed via GraphQL
     console.log("fetchArtifacts needs to be reimplemented with GraphQL query.");
     setError("Fetching artifacts not implemented yet.");
     /*
     try {
        const response = await axios.post('/api/tasks/artifact', {
           agentId: selectedAgentId,
           params: { id: taskId },
        });
        const fetchedArtifacts: Artifact[] = response.data;
        setArtifacts(fetchedArtifacts);
     } catch (error) {
        console.error('Error fetching artifacts (axios - commented out):', error);
     }
     */
   };

   // This handler needs access to setTaskInput, so it stays here
   const handleDuplicateClick = () => {
     // Use 'input' field from the shared Task type instead of 'history'
     if (!currentTask || !currentTask.input || currentTask.input.length === 0) {
       console.warn('Cannot duplicate: Task input not available.');
       setError('Cannot duplicate: Task input not available.');
       return;
     }

     // Assuming the first message in 'input' is the one to duplicate
     const originalMessage = currentTask.input[0];
     // Use shared MessageRole enum 'USER'
     if (originalMessage.role !== 'USER' || !originalMessage.parts || originalMessage.parts.length === 0) {
       console.warn('Cannot duplicate: First input message is not a valid user prompt.');
       setError('Cannot duplicate: First input message is not a valid user prompt.');
       return;
     }

     const originalPart = originalMessage.parts[0];

     if (originalPart.type === 'text') {
       setTaskInput({ type: 'text', content: originalPart.text || '' });
       console.log('Task input populated with original text prompt.');
     } else if (originalPart.type === 'data') {
       try {
         setTaskInput({ type: 'data', content: JSON.stringify(originalPart.data, null, 2) || '' });
         console.log('Task input populated with original data prompt.');
       } catch (e) {
          console.error('Failed to stringify original data part:', e);
          setError('Failed to prepare original data prompt for duplication.');
       }
     } else {
       console.warn(`Duplication not supported for input type: ${originalPart.type}`);
       setError(`Duplication currently not supported for '${originalPart.type}' input type.`);
     }
   };

   // Removed getStatusStyle

   // Simple Tab Styles
   const tabStyle: React.CSSProperties = {
     padding: '10px 15px',
     cursor: 'pointer',
     border: '1px solid #ccc',
     borderBottom: 'none',
     marginRight: '5px',
     borderRadius: '4px 4px 0 0',
     backgroundColor: '#eee',
   };
   const activeTabStyle: React.CSSProperties = {
     ...tabStyle,
     backgroundColor: '#fff',
     borderBottom: '1px solid #fff', // Hide bottom border for active tab
     fontWeight: 'bold',
   };


  // Ensure this log is present before the return statement
  console.log('[AgentInteraction render] Tasks state before passing to TaskList:', tasks);

  return (
    <div style={{ fontFamily: 'sans-serif' }}>

      {selectedAgentId ? (
        <div>
          <div style={{ marginBottom: '0px', borderBottom: '1px solid #ccc' }}>
            <button
              style={activeTab === 'tasks' ? activeTabStyle : tabStyle}
              onClick={() => setActiveTab('tasks')}
            >
              Tasks
            </button>
            <button
              style={activeTab === 'logs' ? activeTabStyle : tabStyle}
              onClick={() => setActiveTab('logs')}
            >
              Logs
            </button>
          </div>

          <div>
            {activeTab === 'logs' && (
              <AgentLogs agentId={selectedAgentId} />
            )}

            {activeTab === 'tasks' && (
              <>
                {/* Pass tasks and loading/error state to TaskList */}
                <TaskList
                  agentId={selectedAgentId}
                  tasks={tasks}
                  loading={listLoading}
                  error={listError}
                  onDeleteTask={handleDeleteTask} // Pass the delete handler down
                  // Pass fetchTasks down if TaskList needs a manual refresh button (optional)
                  // onRefresh={fetchTasks}
                />

                <TaskInputForm
                  taskInput={taskInput}
                  setTaskInput={setTaskInput}
                  onSendTask={handleSendTask}
                  onSendInput={handleInputRequired}
                  isLoading={isLoading}
                  currentTask={currentTask}
                />

                {error && <div style={{ color: 'red', marginBottom: '15px' }}>Error: {error}</div>}

                <TaskDetails
                  currentTask={currentTask}
                  streamingOutput={streamingOutput}
                  // Temporarily cast artifacts to 'any' to resolve type mismatch.
                  // TODO: Investigate TaskDetails props and fix Artifact type properly.
                  artifacts={artifacts as any}
                  onDuplicateClick={handleDuplicateClick}
                />
              </>
            )}
          </div>
       </div>
      ) : (
        <p>Please select an agent from the Agent Management page.</p>
      )}
    </div>
  );
};

export default AgentInteraction;
