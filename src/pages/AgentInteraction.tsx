import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom'; // Import useParams and useNavigate
import { useAgent } from '../contexts/AgentContext';
import AgentLogs from '../components/AgentLogs';
import TaskInputForm from '../components/TaskInputForm';
import { useSubscription } from '@apollo/client';
import { DELETE_TASK_MUTATION, TASK_UPDATES_SUBSCRIPTION, LIST_TASKS_QUERY, CREATE_TASK_MUTATION } from '../graphql/agentTaskQueries';
import TaskList from '../components/TaskList';
import { sendGraphQLRequest } from '../utils/graphqlClient';
import { Task, Artifact, TaskInputState as TaskInput, InputMessage, InputPart, Message, MessagePart } from '../types';
import TaskDetails from '../components/TaskDetails'; // Import TaskDetails directly
import styles from './AgentInteraction.module.css'; // Import the CSS module

const AgentInteraction: React.FC = () => {
  const { agentId: urlAgentId, taskId: urlTaskId } = useParams<{ agentId: string; taskId?: string }>(); // Get agentId and taskId from URL
  const { selectedAgentId, setSelectedAgentId } = useAgent(); // Also get setSelectedAgentId from context
  const navigate = useNavigate(); // Get navigate hook

  const [taskInput, setTaskInput] = useState<TaskInput>({ type: 'text', content: '' });
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'logs' | 'tasks'>('tasks'); // Default to tasks tab


  const [tasks, setTasks] = useState<Task[]>([]);
  const [listLoading, setListLoading] = useState<boolean>(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null); // New state for selected task details
  const [streamingOutput, setStreamingOutput] = useState<string>(''); // State for streaming output


  const fetchTasks = useCallback(async (agentIdToFetch: string) => { // Accept agentId as parameter
    if (!agentIdToFetch) {
      setTasks([]);
      setListError(null);
      return;
    }
    setListLoading(true);
    setListError(null);
    console.log(`[AgentInteraction] Fetching tasks for agent: ${agentIdToFetch}`);
    try {
      const response = await sendGraphQLRequest<{ listTasks: Task[] }>(LIST_TASKS_QUERY.loc!.source.body, { agentId: agentIdToFetch });

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
      // Log the received data to inspect the 'input' field for each task
      data.forEach(task => {
          console.log(`[AgentInteraction fetchTasks] Task ${task.id} input:`, task.input);
      });
      const sortedTasks = data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setTasks(sortedTasks);
      console.log('[AgentInteraction fetchTasks] Tasks state updated:', sortedTasks);
      // After fetching tasks, check if a taskId is in the URL and select that task
      if (urlTaskId) {
        const taskFromUrl = sortedTasks.find(task => task.id === urlTaskId);
        if (taskFromUrl) {
          setSelectedTask(taskFromUrl);
          console.log(`[AgentInteraction fetchTasks] Selected task from URL: ${urlTaskId}`);
        } else {
          console.warn(`[AgentInteraction fetchTasks] Task with ID ${urlTaskId} not found for agent ${agentIdToFetch}.`);
          // Optionally navigate away or show an error if task not found
        }
      }
    } catch (err: any) {
      console.error("[AgentInteraction] Error fetching tasks:", err);
      setListError(err.message);
      setTasks([]);
    } finally {
      setListLoading(false);
    }
  }, [urlTaskId]); // Add urlTaskId to dependencies

  useSubscription(TASK_UPDATES_SUBSCRIPTION, {
    variables: { agentId: urlAgentId }, // Use agentId from URL for subscription
    skip: !urlAgentId, // Skip if no agentId in URL
    onData: ({ data }) => {
      const updatedTask = data?.data?.taskUpdates;
      if (updatedTask) {
        console.log('[AgentInteraction useSubscription] Received task update:', updatedTask);
        // Log the input field received in the subscription update
        console.log('[AgentInteraction useSubscription] Received task update input:', updatedTask.input);

        // Update the tasks list
        setTasks(prevTasks => {
          const existingTaskIndex = prevTasks.findIndex(task => task.id === updatedTask.id);
          if (existingTaskIndex > -1) {
            const newTasks = [...prevTasks];
            // Merge the updated task data, preserving the input if the update doesn't include it
            const mergedTask = { ...newTasks[existingTaskIndex], ...updatedTask, input: newTasks[existingTaskIndex].input || updatedTask.input };
            newTasks[existingTaskIndex] = mergedTask;
            console.log('[AgentInteraction useSubscription] Updated existing task in list:', updatedTask.id);
            return newTasks;
          } else {
            console.log('[AgentInteraction useSubscription] Added new task to list:', updatedTask.id);
            return [updatedTask, ...prevTasks];
          }
        });

        // If the updated task is the currently selected task, update its details
        if (selectedTask && selectedTask.id === updatedTask.id) {
            console.log('[AgentInteraction useSubscription] Updating selected task details with new data for task:', updatedTask.id);
            // Merge the updated task data into the selected task state
            setSelectedTask(prevSelectedTask => {
                if (!prevSelectedTask) return updatedTask;
                const mergedSelectedTask = { ...prevSelectedTask, ...updatedTask, input: prevSelectedTask.input || updatedTask.input };
                console.log('[AgentInteraction useSubscription] Merged selected task input:', mergedSelectedTask.input);
                return mergedSelectedTask;
            });

            console.log('[AgentInteraction useSubscription] Updated selected task output:', updatedTask.output);
            // Assuming streaming output comes in parts and needs to be appended
            // This part might need refinement based on how streaming output is structured in updates
            if (updatedTask.output && updatedTask.output.length > 0) {
                const latestOutput = updatedTask.output[updatedTask.output.length - 1];
                if (latestOutput.parts && latestOutput.parts.length > 0) {
                    const latestPart = latestOutput.parts[latestOutput.parts.length - 1];
                    if (latestPart.type === 'text' && latestPart.text) {
                        setStreamingOutput(prev => prev + latestPart.text);
                    }
                }
            }
        }
      }
    },
    onError: (error) => {
      console.error('[AgentInteraction useSubscription] Subscription error:', error);
    },
  });

  useEffect(() => {
    // On component mount or urlAgentId change, update context and fetch tasks
    if (urlAgentId) {
      console.log(`[AgentInteraction useEffect] URL agentId detected: ${urlAgentId}. Updating context and fetching tasks.`);
      setSelectedAgentId(urlAgentId); // Update context
      fetchTasks(urlAgentId); // Fetch tasks for the agent in the URL
    } else if (selectedAgentId) {
       // If no agentId in URL but one is in context, fetch tasks for context agent
       console.log(`[AgentInteraction useEffect] No URL agentId, but context agentId exists: ${selectedAgentId}. Fetching tasks.`);
       fetchTasks(selectedAgentId);
    } else {
       // No agentId in URL or context
       console.log('[AgentInteraction useEffect] No agentId in URL or context. Clearing tasks.');
       setTasks([]);
    }
  }, [urlAgentId, selectedAgentId, fetchTasks, setSelectedAgentId]); // Add dependencies

  // Effect to select task when tasks list or urlTaskId changes
  useEffect(() => {
    if (urlTaskId && tasks.length > 0) {
      const taskFromUrl = tasks.find(task => task.id === urlTaskId);
      if (taskFromUrl) {
        setSelectedTask(taskFromUrl);
        console.log(`[AgentInteraction useEffect] Selected task from URL after tasks loaded: ${urlTaskId}`);
      } else {
         console.warn(`[AgentInteraction useEffect] Task with ID ${urlTaskId} not found in loaded tasks.`);
         // Optionally handle task not found (e.g., navigate away)
      }
    } else if (!urlTaskId) {
       // If urlTaskId is removed, deselect the task
       setSelectedTask(null);
       setStreamingOutput(''); // Clear streaming output
       console.log('[AgentInteraction useEffect] urlTaskId removed, deselecting task.');
    }
  }, [urlTaskId, tasks]); // Depend on urlTaskId and tasks list

  const handleSelectTask = (task: Task) => {
    setSelectedTask(task);
    // Navigate to the task URL when a task is selected
    if (urlAgentId) {
      navigate(`/agent/view/${urlAgentId}/task/${task.id}`);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    // Use urlAgentId for the mutation
    if (!urlAgentId) {
      setError('Cannot delete task: No agent selected.');
      return;
    }

    if (selectedTask && selectedTask.id === taskId) {
        setSelectedTask(null); // Close details if the deleted task was open
        // Also navigate back to the agent view if the selected task is deleted
        navigate(`/agent/view/${urlAgentId}`);
    }

    console.log(`[AgentInteraction] Attempting to delete task ${taskId} for agent ${urlAgentId}`);
    setIsLoading(true);
    setError(null);

    try {
      const variables = { agentId: urlAgentId, taskId };
      const response = await sendGraphQLRequest<{ deleteTask: boolean }>(DELETE_TASK_MUTATION.loc!.source.body, variables);

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
    // Use urlAgentId for the mutation
    if (!urlAgentId) {
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

      const variables = {
        agentId: urlAgentId, // Use urlAgentId for the mutation
        message: newMessage,
      };

      console.log(`[AgentInteraction] Creating new task by duplicating task ${taskId} for agent ${urlAgentId} with message:`, newMessage);

      const response = await sendGraphQLRequest<{ createTask: Task }>(CREATE_TASK_MUTATION.loc!.source.body, variables);

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
    // Use urlAgentId for the mutation
    if (!urlAgentId) {
      setError('No agent selected.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setArtifacts([]);
    setCurrentTask(null);

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
      agentId: urlAgentId, // Use urlAgentId for the mutation
      message: {
        role: 'USER',
        parts: parts,
      } as InputMessage,
    };

    try {
      const response = await sendGraphQLRequest<{ createTask: Task }>(CREATE_TASK_MUTATION.loc!.source.body, variables);

      if (response.errors) {
        console.error('GraphQL errors:', response.errors);
        const errorMessages = response.errors.map(err => err.message).join('; ');
        setError(`GraphQL Error: ${errorMessages}`);
      } else if (response.data?.createTask) {
        const createdTask = response.data.createTask;
        setCurrentTask(createdTask);
        console.log('Task created:', createdTask);
        setError(null);

        // Use the task object returned by the mutation directly, which includes the input
        setTasks(prevTasks => [createdTask, ...prevTasks]);
        console.log('[AgentInteraction handleSendTask] Added new task with input from mutation response to list state:', createdTask.id, createdTask.input);

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
     if (!urlAgentId) return; // Use urlAgentId
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

      {/* Use urlAgentId to determine if an agent is selected */}
      {urlAgentId ? (
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
                <AgentLogs agentId={urlAgentId} />
              )}

              {activeTab === 'tasks' && (
                <>
                  <TaskList
                    agentId={urlAgentId} // Use urlAgentId
                    tasks={tasks}
                    loading={listLoading}
                    error={listError}
                    onDeleteTask={handleDeleteTask}
                    onViewTaskDetails={handleSelectTask}
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

          {selectedTask && (<div className={styles.rightPane}>
              <TaskDetails
                currentTask={selectedTask} // Pass selectedTask
                streamingOutput={streamingOutput} // Pass streamingOutput state
                onDuplicateClick={() => {
                  handleDuplicateTask(urlAgentId!, selectedTask.id); // Use urlAgentId
                  setSelectedTask(null); // Close details after duplicating
                }}
              />
          </div>)}
        </>
      ) : (
        <p>Please select an agent from the Agent Management page.</p>
      )}
    </div>
  );
};

export default AgentInteraction;
