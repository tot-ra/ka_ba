import React, { useState } from 'react';

import { useAgent } from '../contexts/AgentContext';
import AgentLogs from '../components/AgentLogs';
import TaskInputForm from '../components/TaskInputForm';
import TaskDetails from '../components/TaskDetails';
import TaskList from '../components/TaskList';
import { sendGraphQLRequest } from '../utils/graphqlClient'; // Import the utility function

// --- GraphQL Type Definitions (align with TaskSubmitForm and schema) ---
interface InputPart {
  type: string; // 'text', 'file', 'data'
  content: any; // Matches JSONObject in schema
  metadata?: any;
}

interface InputMessage {
  role: 'USER' | 'AGENT' | 'SYSTEM' | 'TOOL'; // Use uppercase enum values
  parts: InputPart[];
  metadata?: any;
}

// Matches the structure of the Task type returned by the GraphQL mutation
// Use the existing Task interface below, ensure it aligns
// interface GraphQLTaskResponse { ... } // Replaced by existing Task interface

// --- End GraphQL Type Definitions ---


// Keep necessary interfaces (ensure Task aligns with GraphQL response)
interface Agent {
  id: string;
  url: string;
  name?: string;
  description?: string;
}

interface Message {
  role: 'user' | 'agent';
  parts: any[]; // TODO: Define Part interface
  metadata?: any;
}

interface TaskStatus {
  state: 'submitted' | 'working' | 'input-required' | 'completed' | 'canceled' | 'failed' | 'unknown';
  message?: Message | null;
  timestamp: string;
}

interface Artifact {
  name?: string | null;
  description?: string | null;
  parts: any[]; // TODO: Define Part interface
  index: number;
  append?: boolean | null;
  lastChunk?: boolean | null;
  metadata?: any;
}

interface Task {
  id: string;
  sessionId?: string | null;
  status: TaskStatus;
  artifacts?: Artifact[] | null;
  history?: Message[] | null;
  metadata?: any;
}

// TaskInput interface for the form state
interface TaskInput {
  type: 'text' | 'file' | 'data';
  content: string | File | any; // File object for file type, string for others initially
}


const AgentInteraction: React.FC = () => {
  const { selectedAgentId } = useAgent();

  // State managed by AgentInteraction
  const [taskInput, setTaskInput] = useState<TaskInput>({ type: 'text', content: '' }); // State for the form, passed down
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [streamingOutput, setStreamingOutput] = useState(''); // Keep for TaskDetails
  const [artifacts, setArtifacts] = useState<Artifact[]>([]); // Keep for TaskDetails
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'logs' | 'tasks'>('tasks'); // State for tabs


  // Handlers that remain in AgentInteraction as they manage its state
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
        setCurrentTask(createdTask); // Update the current task state
        console.log('Task created:', createdTask);
        setError(null); // Clear previous errors
        // Optionally clear the input form:
        // setTaskInput({ type: 'text', content: '' });
      } else {
        // Handle unexpected response structure
        console.error('Unexpected GraphQL response structure:', response);
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
     if (!currentTask || currentTask.status.state !== 'input-required') return;

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
     if (!currentTask || !currentTask.history || currentTask.history.length === 0) {
       console.warn('Cannot duplicate: Task history not available.');
       setError('Cannot duplicate: Task history not available.');
       return;
     }

     const originalMessage = currentTask.history[0];
     if (originalMessage.role !== 'user' || !originalMessage.parts || originalMessage.parts.length === 0) {
       console.warn('Cannot duplicate: First history message is not a valid user prompt.');
       setError('Cannot duplicate: First history message is not a valid user prompt.');
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
                <TaskList agentId={selectedAgentId} />
                  
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
                  artifacts={artifacts}
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
