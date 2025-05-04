import React, { useState, useEffect, useCallback } from 'react';
import { useAgent } from '../contexts/AgentContext';
import AgentLogs from '../components/AgentLogs';
import TaskInputForm from '../components/TaskInputForm';
import { gql, useSubscription } from '@apollo/client';
import TaskList from '../components/TaskList';
import { sendGraphQLRequest } from '../utils/graphqlClient';
import { Task, Artifact, TaskInputState as TaskInput, InputMessage, InputPart, Message, MessagePart } from '../types';
import TaskDetails from '../components/TaskDetails'; // Import TaskDetails directly
import styles from './AgentInteraction.module.css'; // Import the CSS module

const AgentInteraction: React.FC = () => {
  const { selectedAgentId } = useAgent();

  const [taskInput, setTaskInput] = useState<TaskInput>({ type: 'text', content: '' });
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [streamingOutput, setStreamingOutput] = useState('');
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'logs' | 'tasks'>('tasks');

  const [tasks, setTasks] = useState<Task[]>([]);
  const [listLoading, setListLoading] = useState<boolean>(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null); // New state for selected task details

  const DELETE_TASK_MUTATION = `
    mutation DeleteTask($agentId: ID!, $taskId: ID!) {
      deleteTask(agentId: $agentId, taskId: $taskId)
    }
  `;

  const TASK_UPDATES_SUBSCRIPTION = gql`
    subscription TaskUpdates($agentId: ID!) {
      taskUpdates(agentId: $agentId) {
        id
        state
        input { role parts }
        output { role parts }
        error
        createdAt
        updatedAt
        artifacts
      }
    }
  `;

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
              id
              state
              input { role parts }
              output { role parts }
              error
              createdAt
              updatedAt
              artifacts
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
      const sortedTasks = data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setTasks(sortedTasks);
      console.log('[AgentInteraction fetchTasks] Tasks state updated:', sortedTasks);
    } catch (err: any) {
      console.error("[AgentInteraction] Error fetching tasks:", err);
      setListError(err.message);
      setTasks([]);
    } finally {
      setListLoading(false);
    }
  }, [selectedAgentId]);

  useSubscription(TASK_UPDATES_SUBSCRIPTION, {
    variables: { agentId: selectedAgentId },
    skip: !selectedAgentId,
    onData: ({ data }) => {
      const updatedTask = data?.data?.taskUpdates;
      if (updatedTask) {
        console.log('[AgentInteraction useSubscription] Received task update:', updatedTask);
        setTasks(prevTasks => {
          const existingTaskIndex = prevTasks.findIndex(task => task.id === updatedTask.id);
          if (existingTaskIndex > -1) {
            const newTasks = [...prevTasks];
            newTasks[existingTaskIndex] = updatedTask;
            console.log('[AgentInteraction useSubscription] Updated existing task in list:', updatedTask.id);
            return newTasks;
          } else {
            console.log('[AgentInteraction useSubscription] Added new task to list:', updatedTask.id);
            return [updatedTask, ...prevTasks];
          }
        });

        if (selectedTask && selectedTask.id === updatedTask.id) {
            console.log('[AgentInteraction useSubscription] Updating selected task details with new data for task:', updatedTask.id);
            setSelectedTask(updatedTask);
        }
      }
    },
    onError: (error) => {
      console.error('[AgentInteraction useSubscription] Subscription error:', error);
    },
  });

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const handleSelectTask = (task: Task) => {
    setSelectedTask(task);
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!selectedAgentId) {
      setError('Cannot delete task: No agent selected.');
      return;
    }

    if (selectedTask && selectedTask.id === taskId) {
        setSelectedTask(null); // Close details if the deleted task was open
    }

    console.log(`[AgentInteraction] Attempting to delete task ${taskId} for agent ${selectedAgentId}`);
    setIsLoading(true);
    setError(null);

    try {
      const variables = { agentId: selectedAgentId, taskId };
      const response = await sendGraphQLRequest<{ deleteTask: boolean }>(DELETE_TASK_MUTATION, variables);

      if (response.errors) {
        console.error(`[AgentInteraction] GraphQL errors deleting task ${taskId}:`, response.errors);
        throw new Error(response.errors.map((e: any) => e.message).join(', '));
      }

      if (response.data?.deleteTask === true) {
        console.log(`[AgentInteraction] Successfully deleted task ${taskId}. Removing from list...`);
        setTasks(prevTasks => prevTasks.filter(task => task.id !== taskId));
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

  const handleDuplicateTask = async (agentId: string, taskId: string) => {
    if (!agentId) {
      setError('Cannot duplicate task: No agent selected.');
      return;
    }

    if (selectedTask && selectedTask.id === taskId) {
        setSelectedTask(null); // Close details if the duplicated task was open
    }

    setIsLoading(true);
    setError(null);

    try {
      const taskToDuplicate = tasks.find(task => task.id === taskId);

      if (!taskToDuplicate || !taskToDuplicate.input || taskToDuplicate.input.length === 0) {
        console.warn(`Cannot duplicate task ${taskId}: Task not found or has no input.`);
        setError(`Cannot duplicate task ${taskId}: Task not found or has no input.`);
        setIsLoading(false);
        return;
      }

      const originalMessage = taskToDuplicate.input[0];
      if (originalMessage.role !== 'USER' || !originalMessage.parts || originalMessage.parts.length === 0) {
        console.warn(`Cannot duplicate task ${taskId}: First input message is not a valid user prompt.`);
        setError(`Cannot duplicate task ${taskId}: First input message is not a valid user prompt.`);
        setIsLoading(false);
        return;
      }

      const inputParts: InputPart[] = originalMessage.parts.map(part => {
          let content: any;
          if (part.type === 'text') {
              content = { text: (part as any).text };
          } else if (part.type === 'data') {
              content = (part as any).data;
          } else if (part.type === 'file') {
              content = (part as any).file;
          } else {
              console.warn(`Skipping duplication for unsupported input part type: ${part.type}`);
              return null;
          }

          return {
              type: part.type,
              content: content,
              metadata: part.metadata,
          };
      }).filter(part => part !== null) as InputPart[];

      if (inputParts.length === 0) {
          setError('Could not extract valid input parts from the original task.');
          setIsLoading(false);
          return;
      }

      const newMessage: InputMessage = {
        role: 'USER',
        parts: inputParts,
        metadata: originalMessage.metadata,
      };

      const mutation = `
        mutation CreateTask($agentId: ID, $message: InputMessage!) {
          createTask(agentId: $agentId, message: $message) {
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

      const variables = {
        agentId: agentId,
        message: newMessage,
      };

      console.log(`[AgentInteraction] Creating new task by duplicating task ${taskId} with message:`, newMessage);

      const response = await sendGraphQLRequest<{ createTask: Task }>(mutation, variables);

      if (response.errors) {
        console.error(`[AgentInteraction] GraphQL errors creating duplicated task from ${taskId}:`, response.errors);
        throw new Error(response.errors.map((e: any) => e.message).join('; '));
      } else if (response.data?.createTask) {
        console.log('Duplicated task created:', response.data.createTask);
        setError(null);
      } else {
        console.error('[GraphQL createTask (Duplication)] Unexpected response structure:', response);
        setError('Received an unexpected response structure when creating duplicated task.');
      }

    } catch (err: any) {
      console.error(`[AgentInteraction] Error duplicating task ${taskId}:`, err);
      setError(`Failed to duplicate task: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
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
    setCurrentTask(null);

    const mutation = `
      mutation CreateTask($agentId: ID, $message: InputMessage!) {
        createTask(agentId: $agentId, message: $message) {
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
        const file = taskInput.content as File;
        if (!file) {
           setError('No file selected.');
           setIsLoading(false);
           return;
        }
        console.warn('File part creation not fully implemented. Sending placeholder.');
        parts.push({ type: 'text', content: { text: `File: ${file.name} (upload not implemented)` } });
      } else if (taskInput.type === 'data') {
        if (!taskInput.content || typeof taskInput.content !== 'string' || !taskInput.content.trim()) {
           setError('JSON data cannot be empty.');
           setIsLoading(false);
           return;
        }
        try {
          const jsonData = JSON.parse(taskInput.content);
          parts.push({ type: 'data', content: jsonData });
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

    const variables = {
      agentId: selectedAgentId,
      message: {
        role: 'USER',
        parts: parts,
      } as InputMessage,
    };

    try {
      const response = await sendGraphQLRequest<{ createTask: Task }>(mutation, variables);

      if (response.errors) {
        console.error('GraphQL errors:', response.errors);
        const errorMessages = response.errors.map(err => err.message).join('; ');
        setError(`GraphQL Error: ${errorMessages}`);
      } else if (response.data?.createTask) {
        const createdTask = response.data.createTask;
        setCurrentTask(createdTask);
        console.log('Task created:', createdTask);
        setError(null);

        const uiInputMessage: Message = {
            role: variables.message.role,
            parts: variables.message.parts.map(part => {
                if (part.type === 'text') {
                    return { type: 'text', text: part.content.text, metadata: part.metadata };
                }
                console.warn(`Mapping not fully implemented for input part type: ${part.type}. Adding raw content.`);
                return { type: part.type, ...part.content, metadata: part.metadata };
            }) as MessagePart[],
            metadata: variables.message.metadata,
        };

        const uiTask: Task = {
            id: createdTask.id,
            state: createdTask.state,
            input: [uiInputMessage],
            output: createdTask.output,
            error: createdTask.error,
            createdAt: createdTask.createdAt,
            updatedAt: createdTask.updatedAt,
            artifacts: createdTask.artifacts,
        };

        setTasks(prevTasks => [uiTask, ...prevTasks]);
        console.log('[AgentInteraction handleSendTask] Added new task with input to list state:', uiTask.id, uiTask.input);

      } else {
        console.error('[GraphQL createTask] Unexpected GraphQL response structure:', response);
        setError('Received an unexpected response structure from the server.');
      }
    } catch (error: any) {
      console.error('Error submitting task via GraphQL utility:', error);
      setError(`Network or Server Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleInputRequired = async () => {
     if (!currentTask || currentTask.state !== 'INPUT_REQUIRED') return;

     setIsLoading(true);
     setError(null);
     setError("Sending input not implemented yet.");
     setIsLoading(false);
  };

  const fetchArtifacts = async (taskId: string) => {
     if (!selectedAgentId) return;
     console.log("fetchArtifacts needs to be reimplemented with GraphQL query.");
     setError("Fetching artifacts not implemented yet.");
   };

   const handleDuplicateClick = () => {
     if (!currentTask || !currentTask.input || currentTask.input.length === 0) {
       console.warn('Cannot duplicate: Task input not available.');
       setError('Cannot duplicate: Task input not available.');
       return;
     }

     const originalMessage = currentTask.input[0];
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
     borderBottom: '1px solid #fff',
     fontWeight: 'bold',
   };

  console.log('[AgentInteraction render] Tasks state before passing to TaskList:', tasks);

  return (
    <div className={styles.splitContainer}> {/* Apply splitContainer class */}

      {selectedAgentId ? (
        <> {/* Use fragment for multiple top-level elements */}
          <div className={styles.leftPane}> {/* Apply leftPane class */}
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
                  <TaskList
                    agentId={selectedAgentId}
                    tasks={tasks}
                    loading={listLoading}
                    error={listError}
                    onDeleteTask={handleDeleteTask}
                    onViewTaskDetails={handleSelectTask} // Changed to handleSelectTask
                    onDuplicateTask={handleDuplicateTask}
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

                </>
              )}
            </div>
          </div>

          <div className={styles.rightPane}> {/* Apply rightPane class */}
            {selectedTask ? (
              <TaskDetails
                currentTask={selectedTask} // Pass selectedTask
                streamingOutput={''} // Streaming output is not relevant for historical task details
                onDuplicateClick={() => {
                  handleDuplicateTask(selectedAgentId!, selectedTask.id);
                  setSelectedTask(null); // Close details after duplicating
                }}
              />
            ) : (
              <p>Select a task from the list to view details.</p>
            )}
          </div>
        </>
      ) : (
        <p>Please select an agent from the Agent Management page.</p>
      )}
    </div>
  );
};

export default AgentInteraction;
