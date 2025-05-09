import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useSubscription } from '@apollo/client';

import { useAgent } from '../contexts/AgentContext';
import TaskInputForm from '../components/TaskInputForm';
import { DELETE_TASK_MUTATION, TASK_UPDATES_SUBSCRIPTION, LIST_TASKS_QUERY, CREATE_TASK_MUTATION } from '../graphql/agentTaskQueries';
import TaskList from '../components/TaskList';
import { sendGraphQLRequest } from '../utils/graphqlClient';
import { Task, Artifact, TaskInputState as TaskInput, InputMessage, InputPart, MessagePart, TextPart, DataPart, FilePart } from '../types';
import TaskDetails from '../components/TaskDetails';
import styles from './AgentInteraction.module.css';

const AgentInteraction: React.FC = () => {
  const { agentId: urlAgentId, taskId: urlTaskId } = useParams<{ agentId: string; taskId?: string }>();
  const { selectedAgentId, setSelectedAgentId } = useAgent();
  const navigate = useNavigate();

  const [taskInput, setTaskInput] = useState<TaskInput>({ type: 'text', content: '' });
  const [currentTask, setCurrentTask] = useState<Task | null>(null);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [listLoading, setListLoading] = useState<boolean>(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [streamingOutput, setStreamingOutput] = useState<string>('');

  const fetchTasks = useCallback(async (agentIdToFetch: string) => {
    if (!agentIdToFetch) {
      setTasks([]);
      setListError(null);
      return;
    }
    setListLoading(true);
    setListError(null);
    try {
      const response = await sendGraphQLRequest<{ listTasks: Task[] }>(LIST_TASKS_QUERY.loc!.source.body, { agentId: agentIdToFetch });

      if (response.errors) {
        throw new Error(response.errors.map((e: any) => e.message).join(', '));
      }
      const data = response.data?.listTasks;
      if (!data || !Array.isArray(data)) {
        throw new Error('Invalid data format received from server.');
      }
      const sortedTasks = data.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setTasks(sortedTasks);
      if (urlTaskId) {
        const taskFromUrl = sortedTasks.find(task => task.id === urlTaskId);
        if (taskFromUrl) {
          setSelectedTask(taskFromUrl);
        }
      }
    } catch (err: any) {
      setError(err.message);
      setTasks([]);
    } finally {
      setListLoading(false);
    }
  }, [urlTaskId]);

  useSubscription(TASK_UPDATES_SUBSCRIPTION, {
    variables: { agentId: urlAgentId },
    skip: !urlAgentId,
    onData: ({ data }) => {
      const updatedTask = data?.data?.taskUpdates;
      if (updatedTask) {
        setTasks(prevTasks => {
          const existingTaskIndex = prevTasks.findIndex(task => task.id === updatedTask.id);
          if (existingTaskIndex > -1) {
            const newTasks = [...prevTasks];
            const mergedTask = { ...newTasks[existingTaskIndex], ...updatedTask };
            newTasks[existingTaskIndex] = mergedTask;
            return newTasks;
          } else {
            return [updatedTask, ...prevTasks];
          }
        });

        if (selectedTask && selectedTask.id === updatedTask.id) {
            setSelectedTask(prevSelectedTask => {
                if (!prevSelectedTask) return updatedTask;
                const mergedSelectedTask = { ...prevSelectedTask, ...updatedTask };
                return mergedSelectedTask;
            });

            if (updatedTask.output && updatedTask.output.length > 0) {
                const latestOutput = updatedTask.output[updatedTask.output.length - 1];
                if (latestOutput.parts && latestOutput.parts.length > 0) {
                    const latestPart = latestOutput.parts[latestOutput.parts.length - 1];
                    if (latestPart.type === 'text' && (latestPart as TextPart).text) {
                        setStreamingOutput(prev => prev + (latestPart as TextPart).text);
                    }
                }
            }
        }
      }
    },
    onError: (error) => {
      console.error('Subscription error:', error);
    },
  });

  useEffect(() => {
    if (urlAgentId) {
      setSelectedAgentId(urlAgentId);
      fetchTasks(urlAgentId);
    } else if (selectedAgentId) {
       fetchTasks(selectedAgentId);
    } else {
       setTasks([]);
    }
  }, [urlAgentId, selectedAgentId, fetchTasks, setSelectedAgentId]);

  useEffect(() => {
    if (urlTaskId && tasks.length > 0) {
      const taskFromUrl = tasks.find(task => task.id === urlTaskId);
      if (taskFromUrl) {
        setSelectedTask(taskFromUrl);
      }
    } else if (!urlTaskId) {
       setSelectedTask(null);
       setStreamingOutput('');
    }
  }, [urlTaskId, tasks]);

  const handleSelectTask = (task: Task) => {
    setSelectedTask(task);
    if (urlAgentId) {
      navigate(`/agent/view/${urlAgentId}/task/${task.id}`);
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!urlAgentId) {
      setError('Cannot delete task: No agent selected.');
      return;
    }

    if (selectedTask && selectedTask.id === taskId) {
        setSelectedTask(null);
        navigate(`/agent/view/${urlAgentId}`);
    }

    setIsLoading(true);
    setError(null);

    try {
      const variables = { agentId: urlAgentId, taskId };
      const response = await sendGraphQLRequest<{ deleteTask: boolean }>(DELETE_TASK_MUTATION.loc!.source.body, variables);

      if (response.errors) {
        throw new Error(response.errors.map((e: any) => e.message).join(', '));
      }

      if (response.data?.deleteTask === true) {
        setTasks(prevTasks => prevTasks.filter(task => task.id !== taskId));
      } else {
        setError(`Failed to delete task ${taskId}. Agent might have failed or task already deleted.`);
      }
    } catch (err: any) {
      setError(`Failed to delete task: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDuplicateTask = async (agentId: string, taskId: string) => {
    if (!urlAgentId) {
      setError('Cannot duplicate task: No agent selected.');
      return;
    }

    if (selectedTask && selectedTask.id === taskId) {
        setSelectedTask(null);
    }

    setIsLoading(true);
    setError(null);

    try {
      const taskToDuplicate = tasks.find(task => task.id === taskId);

      if (!taskToDuplicate || !taskToDuplicate.messages || taskToDuplicate.messages.length === 0) {
        setError(`Cannot duplicate task ${taskId}: Task not found or has no messages.`);
        setIsLoading(false);
        return;
      }

      const originalMessage = taskToDuplicate.messages.find(msg => msg.role === 'USER');

      if (!originalMessage || !originalMessage.parts || originalMessage.parts.length === 0) {
        setError(`Cannot duplicate task ${taskId}: Original user input message not found or is empty.`);
        setIsLoading(false);
        return;
      }

      const inputParts: InputPart[] = originalMessage.parts.map((part: MessagePart) => {
          let content: any;
          if (part.type === 'text') {
              content = { text: (part as TextPart).text };
          } else if (part.type === 'data') {
              content = (part as DataPart).data;
          } else if (part.type === 'file') {
              content = { uri: (part as FilePart).uri, fileName: (part as FilePart).fileName };
          } else {
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
        agentId: urlAgentId,
        message: newMessage,
      };

      const response = await sendGraphQLRequest<{ createTask: Task }>(CREATE_TASK_MUTATION.loc!.source.body, variables);

      if (response.errors) {
        throw new Error(response.errors.map((e: any) => e.message).join('; '));
      } else if (response.data?.createTask) {
        setError(null);
      } else {
        setError('Received an unexpected response structure when creating duplicated task.');
      }

    } catch (err: any) {
      setError(`Failed to duplicate task: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendTask = async (e: React.FormEvent) => {
    e.preventDefault();
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
        parts.push({ type: 'text', content: { text: taskInput.content as string } });
      } else if (taskInput.type === 'file') {
        const file = taskInput.content as File;
        if (!file) {
           setError('No file selected.');
           setIsLoading(false);
           return;
        }
        parts.push({ type: 'text', content: { text: `File: ${file.name} (upload not implemented)` } });
      } else if (taskInput.type === 'data') {
        if (!taskInput.content || typeof taskInput.content !== 'string' || !taskInput.content.trim()) {
           setError('JSON data cannot be empty.');
           setIsLoading(false);
           return;
        }
        try {
          const jsonData = JSON.parse(taskInput.content as string);
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
      agentId: urlAgentId,
      message: {
        role: 'USER',
        parts: parts,
      } as InputMessage,
    };

    try {
      const response = await sendGraphQLRequest<{ createTask: Task }>(CREATE_TASK_MUTATION.loc!.source.body, variables);

      if (response.errors) {
        const errorMessages = response.errors.map(err => err.message).join('; ');
        setError(`GraphQL Error: ${errorMessages}`);
      } else if (response.data?.createTask) {
        const createdTask = response.data.createTask;
        setCurrentTask(createdTask);
        setError(null);
        setTasks(prevTasks => [createdTask, ...prevTasks]);
      } else {
        setError('Received an unexpected response structure from the server.');
      }
    } catch (error: any) {
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
     if (!urlAgentId) return;
     setError("Fetching artifacts not implemented yet.");
   };

   const handleDuplicateClick = () => {
     if (!currentTask || !currentTask.messages || currentTask.messages.length === 0) {
       setError('Cannot duplicate: Task messages not available.');
       return;
     }

     const originalMessage = currentTask.messages.find(msg => msg.role === 'USER');
     if (!originalMessage || !originalMessage.parts || originalMessage.parts.length === 0) {
       setError('Cannot duplicate: Original user input message not found or is empty.');
       return;
     }

     const originalPart = originalMessage.parts[0];

     if (originalPart.type === 'text') {
       setTaskInput({ type: 'text', content: (originalPart as unknown as TextPart).text || '' });
     } else if (originalPart.type === 'data') {
       try {
         setTaskInput({ type: 'data', content: JSON.stringify((originalPart as unknown as DataPart).data, null, 2) || '' });
       } catch (e) {
          setError('Failed to prepare original data prompt for duplication.');
       }
     } else {
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

  return (
    <div className={styles.splitContainer}>
      {urlAgentId ? (
        <>
          <div className={styles.leftPane}>
              <TaskList
                agentId={urlAgentId}
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
          </div>

          {selectedTask && (<div className={styles.rightPane}>
              <TaskDetails
                currentTask={selectedTask}
                streamingOutput={streamingOutput}
                onDuplicateClick={() => {
                  handleDuplicateTask(urlAgentId!, selectedTask.id);
                  setSelectedTask(null);
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
