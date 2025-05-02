import React, { useState } from 'react'; // Removed useEffect for now, might be needed later

import { useAgent } from '../contexts/AgentContext';
import AgentLogs from '../components/AgentLogs';
import TaskInputForm from '../components/TaskInputForm'; // Import TaskInputForm
import TaskDetails from '../components/TaskDetails'; // Import TaskDetails
import TaskList from '../components/TaskList'; // Import the TaskList component

// Keep necessary interfaces
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

// TaskInput interface is now managed within TaskInputForm, but needed for state definition
interface TaskInput {
  type: 'text' | 'file' | 'data';
  content: string | File | any;
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

  // TODO: Define CREATE_TASK_MUTATION if replacing axios call

  // Removed handlers now inside TaskInputForm: handleInputChange, handleFileChange, handleDataTypeChange
  // Removed getStatusStyle, now inside TaskDetails

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
    setStreamingOutput(''); // Keep this if task output is separate
    setArtifacts([]);

    // TODO: Replace this with GraphQL mutation call
    console.log("handleSendTask needs to be reimplemented with GraphQL mutation.");
    setError("Sending tasks not implemented yet.");
    /*
    try {
      // Construct message based on input type
      const message: Message = {
        role: 'user',
        parts: [],
      };

      if (taskInput.type === 'text') {
        message.parts.push({ type: 'text', text: taskInput.content as string });
      } else if (taskInput.type === 'file') {
        const file = taskInput.content as File;
        // TODO: Implement file reading and base64 encoding or URI handling
        console.warn('File upload not fully implemented.');
        // For now, just add a placeholder part
         message.parts.push({ type: 'text', text: `File: ${file.name} (upload not supported yet)` });
      } else if (taskInput.type === 'data') {
         try {
            const data = JSON.parse(taskInput.content as string);
            message.parts.push({ type: 'data', data });
         } catch (jsonError) {
            setError('Invalid JSON data.');
            setIsLoading(false);
            return;
         }
      }


      // Assuming a backend proxy endpoint for sending tasks
      const response = await axios.post('/api/tasks/send', {
        agentId: selectedAgentId,
        params: {
          id: `task-${Date.now()}`, // Simple task ID
          message,
          // TODO: Add sessionId, pushNotification, historyLength, metadata if needed
        },
      });

      const task: Task = response.data; // Assuming backend returns the Task object

      if (task) {
        setCurrentTask(task);
        console.log('Task sent:', task);
        // TODO: Handle streaming response if agent supports it
        // If streaming, the SSE useEffect will handle updates.
        // If not streaming, might need to poll for status/artifacts.
      } else {
        setError('Failed to send task.');
      }

    } catch (error: any) {
      console.error('Error sending task (axios - commented out):', error);
      setError(`Error sending task: ${error.message}`);
    } finally {
      setIsLoading(false); // Ensure loading state is reset even if commented out
    }
    */
    setIsLoading(false); // Reset loading state immediately as the call is commented out
    // Remove extra closing brace below
  };

  const handleInputRequired = async () => {
     if (!currentTask || currentTask.status.state !== 'input-required') return;

     setIsLoading(true);
     setError(null);

     // TODO: Replace this with GraphQL mutation call if applicable, or keep if it's a separate API endpoint
     console.log("handleInputRequired needs to be reimplemented.");
     setError("Sending input not implemented yet.");
     /*
     try {
        // Construct input message based on current taskInput state
        const inputMessage: Message = {
           role: 'user',
           parts: [],
        };

        if (taskInput.type === 'text') {
           inputMessage.parts.push({ type: 'text', text: taskInput.content as string });
        } else if (taskInput.type === 'file') {
           const file = taskInput.content as File;
           // TODO: Implement file reading and base64 encoding or URI handling for input
           console.warn('File upload for input not fully implemented.');
            inputMessage.parts.push({ type: 'text', text: `Input File: ${file.name} (upload not supported yet)` });
        } else if (taskInput.type === 'data') {
           try {
              const data = JSON.parse(taskInput.content as string);
              inputMessage.parts.push({ type: 'data', data });
           } catch (jsonError) {
              setError('Invalid JSON data for input.');
              setIsLoading(false);
              return;
           }
        }

        // Assuming a backend proxy endpoint for input tasks
        const response = await axios.post('/api/tasks/input', {
           agentId: selectedAgentId,
           params: {
              id: currentTask.id,
              message: inputMessage,
              // TODO: Add metadata if needed
           },
        });

        const updatedTask: Task = response.data; // Assuming backend returns the updated Task object

        if (updatedTask) {
           setCurrentTask(updatedTask);
           console.log('Input sent, task updated:', updatedTask);
           // Task state should change from input-required
        } else {
           setError('Failed to send input to agent.');
        }

     } catch (error: any) {
        console.error('Error sending input (axios - commented out):', error);
        setError(`Error sending input: ${error.message}`);
     } finally {
       setIsLoading(false); // Ensure loading state is reset even if commented out
     }
     */
     setIsLoading(false); // Reset loading state immediately as the call is commented out
     // Remove extra closing brace below
  };


  // --- Remove Polling Effect ---
  // useEffect(() => { ... polling logic removed ... }, [currentTask?.id, currentTask?.status.state, selectedAgentId]);


  // Implement fetching artifacts (keep for now, might be triggered differently)
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
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>

      {selectedAgentId ? (
        <div>
          <p>Interacting with Agent ID: <strong>{selectedAgentId}</strong></p>
          {/* TODO: Display selected agent details (name, description, capabilities) */}

          {/* Tabs */}
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

          {/* Tab Content */}
          <div style={{ paddingTop: '20px' }}>
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
