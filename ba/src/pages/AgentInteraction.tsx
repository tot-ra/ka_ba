import React, { useState, useEffect } from 'react';
import axios from 'axios';

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
  // TODO: Get selected agent ID from a shared state (context, global state)
  const selectedAgentId = 'some-agent-id'; // Placeholder

  const [taskInput, setTaskInput] = useState<TaskInput>({ type: 'text', content: '' });
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [streamingOutput, setStreamingOutput] = useState('');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Implement SSE connection for streaming updates
  useEffect(() => {
    if (!selectedAgentId || !currentTask?.id) return;

    const eventSource = new EventSource(`/api/tasks/sendSubscribe?agentId=${selectedAgentId}&taskId=${currentTask.id}`);

    eventSource.onmessage = (event) => {
      const update = JSON.parse(event.data);
      console.log('SSE update received:', update);

      if (update.result) {
        if (update.result.status) {
          // Handle status update
          setCurrentTask(prevTask => {
            if (!prevTask) return null;
            const updatedTask = { ...prevTask, status: update.result.status };
            // If state is final, fetch artifacts
            if (['completed', 'failed', 'canceled'].includes(updatedTask.status.state)) {
               fetchArtifacts(updatedTask.id);
            }
            return updatedTask;
          });
        }
        if (update.result.artifact) {
          // Handle artifact update (assuming artifacts are appended or replace)
          setArtifacts(prevArtifacts => {
             // Simple append for now, more complex logic might be needed based on 'append' flag
             return [...prevArtifacts, update.result.artifact];
          });
        }
        // Handle streaming text output (assuming text parts in status messages or separate events)
        if (update.result.status?.message?.parts) {
           const textParts = update.result.status.message.parts.filter((part: any) => part.type === 'text');
           if (textParts.length > 0) {
              setStreamingOutput(prevOutput => prevOutput + textParts.map((part: any) => part.text).join(''));
           }
        }
      } else if (update.error) {
        console.error('SSE error event:', update.error);
        setError(`Agent Error: ${update.error.message}`);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE error:', err);
      setError('SSE connection error.');
      eventSource.close();
    };

    eventSource.onopen = () => {
       console.log('SSE connection opened.');
    };

    return () => {
      console.log('SSE connection closing.');
      eventSource.close();
    };

  }, [selectedAgentId, currentTask?.id]); // Reconnect if selected agent or task changes

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

  const handleSendTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAgentId) {
      setError('No agent selected.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setStreamingOutput('');
    setArtifacts([]);

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
      console.error('Error sending task:', error);
      setError(`Error sending task: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputRequired = async () => {
     if (!currentTask || currentTask.status.state !== 'input-required') return;

     setIsLoading(true);
     setError(null);

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
        console.error('Error sending input:', error);
        setError(`Error sending input: ${error.message}`);
     } finally {
        setIsLoading(false);
     }
  };


  // Poll for task status if not streaming or for summary views
  useEffect(() => {
    // Only poll if there's a current task, an agent ID, and the task is in a non-final state
    if (!currentTask || !selectedAgentId || ['completed', 'failed', 'canceled'].includes(currentTask.status.state)) {
      return; // Stop polling or don't start
    }

    // TODO: Add logic here to determine if polling is actually needed (e.g., if SSE connection failed or agent doesn't support streaming)
    // For now, we assume polling runs alongside SSE or as a fallback.

    const pollStatus = async () => {
      console.log(`Polling status for task ${currentTask.id}...`);
      try {
        const response = await axios.post('/api/tasks/status', {
          agentId: selectedAgentId,
          params: { id: currentTask.id },
        });
        const updatedTask: Task = response.data;
        if (updatedTask) {
          console.log('Poll update received:', updatedTask);
          setCurrentTask(prevTask => {
            // Avoid unnecessary updates if status hasn't changed
            if (prevTask && prevTask.status.state === updatedTask.status.state) {
               return prevTask;
            }
            // If state becomes final via polling, fetch artifacts (SSE effect also does this)
            if (['completed', 'failed', 'canceled'].includes(updatedTask.status.state)) {
               fetchArtifacts(updatedTask.id);
            }
            return updatedTask;
          });
        }
      } catch (error) {
        console.error('Error polling task status:', error);
        // Optionally set an error state or stop polling on repeated errors
      }
    };

    const intervalId = setInterval(pollStatus, 5000); // Poll every 5 seconds

    // Cleanup function to clear the interval when the component unmounts
    // or when the dependencies change (task ID, status, agent ID)
    return () => {
       console.log(`Stopping polling for task ${currentTask.id}`);
       clearInterval(intervalId);
    };
  }, [currentTask?.id, currentTask?.status.state, selectedAgentId]); // Dependencies for the polling effect


  // Implement fetching artifacts
  const fetchArtifacts = async (taskId: string) => {
     if (!selectedAgentId) return;
     try {
        const response = await axios.post('/api/tasks/artifact', {
           agentId: selectedAgentId,
           params: { id: taskId },
        });
        const fetchedArtifacts: Artifact[] = response.data;
        setArtifacts(fetchedArtifacts);
     } catch (error) {
        console.error('Error fetching artifacts:', error);
     }
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
      <h1 style={{ borderBottom: '2px solid #eee', paddingBottom: '10px' }}>Agent Interaction</h1>

      {selectedAgentId ? (
        <div>
          <p>Interacting with Agent ID: <strong>{selectedAgentId}</strong></p>
          {/* TODO: Display selected agent details (name, description, capabilities) */}

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

          {/* TODO: Display streaming output */}
          {streamingOutput && (
             <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '4px' }}>
                <h3>Streaming Output</h3>
                <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{streamingOutput}</pre>
             </div>
          )}


          {/* TODO: Display artifacts */}
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
