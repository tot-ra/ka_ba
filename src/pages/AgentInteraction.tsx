import React, { useState, useEffect } from 'react'; // Removed useRef
import { gql, useMutation } from '@apollo/client'; // Removed useSubscription, useQuery, OnDataOptions, ApolloError
import { useAgent } from '../contexts/AgentContext';
import AgentLogs from '../components/AgentLogs'; // Import the new component

// Removed LogEntry interface

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

interface TaskInput {
  type: 'text' | 'file' | 'data'; // Simplified for UI
  content: string | File | any; // string for text/data, File for file upload
}

const AgentInteraction: React.FC = () => {
  // Get selected agent ID from context
  const { selectedAgentId } = useAgent(); // Use the hook

  const [taskInput, setTaskInput] = useState<TaskInput>({ type: 'text', content: '' });
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [streamingOutput, setStreamingOutput] = useState('');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Removed log-related state and refs

  // TODO: Define CREATE_TASK_MUTATION if replacing axios call

  // Removed log-related GraphQL definitions and hooks

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setTaskInput({ ...taskInput, content: e.target.value });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setTaskInput({ type: 'file', content: e.target.files[0] });
    }
  };

  const handleDataTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
      setTaskInput({ type: e.target.value as 'text' | 'file' | 'data', content: '' });
  };

  // Removed log scrolling effect

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

   const getStatusStyle = (state: TaskStatus['state']): React.CSSProperties => {
      let backgroundColor = '#eee';
      let color = '#333';
      switch (state) {
         case 'submitted':
         case 'unknown':
            backgroundColor = '#d3d3d3'; // Light Gray
            break;
         case 'working':
            backgroundColor = '#cfe2ff'; // Light Blue
            color = '#004085';
            break;
         case 'input-required':
            backgroundColor = '#fff3cd'; // Light Yellow
            color = '#856404';
            break;
         case 'completed':
            backgroundColor = '#d4edda'; // Light Green
            color = '#155724';
            break;
         case 'canceled':
            backgroundColor = '#f8d7da'; // Light Red
            color = '#721c24';
            break;
         case 'failed':
            backgroundColor = '#f8d7da'; // Light Red
            color = '#721c24';
            break;
      }
      return {
         display: 'inline-block',
         padding: '0.25em 0.6em',
         fontSize: '75%',
         fontWeight: 700,
         lineHeight: 1,
         textAlign: 'center',
         whiteSpace: 'nowrap',
         verticalAlign: 'baseline',
         borderRadius: '0.25rem',
         backgroundColor,
         color,
      };
   };


  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>

      {selectedAgentId ? (
        <div>
          <p>Interacting with Agent ID: <strong>{selectedAgentId}</strong></p>
          {/* TODO: Display selected agent details (name, description, capabilities) */}


          {/* Use the new AgentLogs component */}
          <AgentLogs agentId={selectedAgentId} />

          <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '4px' }}>
            <h3 style={{ marginTop: 0 }}>Task Input</h3>
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
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
               ></textarea>
            )}
            {taskInput.type === 'file' && (
               <input type="file" onChange={handleFileChange} />
            )}
             {taskInput.type === 'data' && (
               <textarea
                  placeholder="Enter JSON data..."
                  value={taskInput.content as string}
                  onChange={handleInputChange}
                  rows={5}
                  style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
               ></textarea>
            )}
            <button
              onClick={handleSendTask}
              disabled={isLoading || !taskInput.content}
              style={{
                marginTop: '10px',
                padding: '10px 15px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                opacity: isLoading || !taskInput.content ? 0.6 : 1,
              }}
            >
              {isLoading ? 'Sending...' : 'Send Task'}
            </button>
             {currentTask?.status.state === 'input-required' && (
                <button
                   onClick={handleInputRequired}
                   disabled={isLoading || !taskInput.content}
                   style={{
                      marginTop: '10px',
                      marginLeft: '10px',
                      padding: '10px 15px',
                      backgroundColor: '#ffc107',
                      color: 'black',
                      border: 'none',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      opacity: isLoading || !taskInput.content ? 0.6 : 1,
                   }}
                >
                   Submit Input
                </button>
             )}
          </div>

          {error && <div style={{ color: 'red', marginBottom: '15px' }}>Error: {error}</div>}

          {currentTask && (
            <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '4px' }}>
              <h3>
                 Task Status: <span style={getStatusStyle(currentTask.status.state)}>{currentTask.status.state}</span>
               </h3>
               <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                 <p style={{ margin: 0 }}>Task ID: {currentTask.id}</p>
                 <button
                   onClick={handleDuplicateClick}
                   disabled={!currentTask?.history || currentTask.history.length === 0 || currentTask.history[0].role !== 'user' || !['text', 'data'].includes(currentTask.history[0].parts?.[0]?.type)}
                   title={!currentTask?.history || currentTask.history.length === 0 || currentTask.history[0].role !== 'user' || !['text', 'data'].includes(currentTask.history[0].parts?.[0]?.type) ? 'Duplication only supported for tasks initiated with text or data' : 'Duplicate Task (copies prompt to input)'}
                   style={{
                     padding: '5px 10px',
                     fontSize: '0.8em',
                     backgroundColor: '#6c757d',
                     color: 'white',
                     border: 'none',
                     borderRadius: '4px',
                     cursor: 'pointer',
                     opacity: (!currentTask?.history || currentTask.history.length === 0 || currentTask.history[0].role !== 'user' || !['text', 'data'].includes(currentTask.history[0].parts?.[0]?.type)) ? 0.5 : 1,
                   }}
                 >
                   Duplicate Task
                 </button>
               </div>
               {currentTask.status.message && (
                  <div style={{ marginTop: '10px', padding: '10px', border: '1px dashed #ccc', borderRadius: '4px', background: '#f9f9f9' }}>
                     <h4>Agent Message:</h4>
                    {currentTask.status.message.parts?.map((part, index) => {
                       if (part.type === 'text') {
                          return <p key={index} style={{ whiteSpace: 'pre-wrap', margin: '5px 0' }}>{part.text}</p>;
                       }
                       // TODO: Render other part types (data, file references) if needed
                       return <pre key={index} style={{ fontSize: '0.9em' }}>{JSON.stringify(part, null, 2)}</pre>;
                    })}
                    {/* Fallback for messages without parts or non-standard structure */}
                    {(!currentTask.status.message.parts || currentTask.status.message.parts.length === 0) && (
                       <pre style={{ fontSize: '0.9em' }}>{JSON.stringify(currentTask.status.message, null, 2)}</pre>
                    )}
                 </div>
              )}
            </div>
          )}

          {/* Display streaming output (keep if separate from logs) */}
          {streamingOutput && (
             <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '4px' }}>
                <h3>Task Output</h3>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{streamingOutput}</pre>
             </div>
          )}

          {/* Display artifacts (keep for now) */}
           {artifacts.length > 0 && (
             <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '4px' }}>
                <h3>Artifacts</h3>
                <ul>
                   {artifacts.map((artifact, index) => (
                      <li key={index}>
                          <h4>{artifact.name || `Artifact ${index + 1}`}</h4>
                          {artifact.description && <p>{artifact.description}</p>}
                          {artifact.parts?.map((part, partIndex) => (
                             <div key={partIndex} style={{ marginTop: '5px', paddingLeft: '15px', borderLeft: '2px solid #eee' }}>
                                {part.type === 'text' && (
                                   <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f0f0f0', padding: '5px' }}>{part.text}</pre>
                                )}
                                {part.type === 'data' && (
                                   <pre style={{ fontSize: '0.9em', background: '#f0f0f0', padding: '5px' }}>{JSON.stringify(part.data, null, 2)}</pre>
                                )}
                                {part.type === 'uri' && (
                                   <a href={part.uri} target="_blank" rel="noopener noreferrer">Download/View Artifact ({part.mimeType || 'link'})</a>
                                )}
                                {part.type === 'file' && (
                                   // TODO: Implement actual file download link/button using a dedicated endpoint if necessary
                                   <span>File: {part.fileName || 'Unnamed File'} ({part.mimeType}) - Download not implemented</span>
                                )}
                                {/* Render other potential part types or provide a fallback */}
                                {!['text', 'data', 'uri', 'file'].includes(part.type) && (
                                    <pre style={{ fontSize: '0.9em' }}>Unsupported part type: {JSON.stringify(part, null, 2)}</pre>
                                )}
                             </div>
                          ))}
                       </li>
                    ))}
                 </ul>
             </div>
          )}


        </div>
      ) : (
        <p>Please select an agent from the Agent Management page.</p>
      )}
    </div>
  );
};

export default AgentInteraction;
