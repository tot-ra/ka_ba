import { Agent } from '../services/agentRegistry.js'; // Import Agent from agentRegistry
import { A2AClient, TaskSendParams, Task as A2ATask, Message as A2AMessage, Part as A2APart } from '../a2aClient.js'; // Alias A2A types
import { GraphQLError } from 'graphql';
import { ApolloContext } from './server.js';

// Define the payload structure for the agentLogs subscription
export interface LogEntryPayload {
  timestamp: string; // ISO timestamp string
  stream: 'stdout' | 'stderr';
  line: string;
}

// Define the structure of the arguments for the createTask mutation
interface CreateTaskArgs {
  agentId?: string;
  sessionId?: string;
  systemPrompt?: string; // Added systemPrompt field
  message: { // Corresponds to InputMessage
    role: 'user' | 'agent'; // Assuming MessageRole maps directly
    parts: Array<{ // Corresponds to InputPart
      type: string;
      content: any; // The JSONObject from schema
      metadata?: any;
    }>;
    metadata?: any;
  };
  pushNotification?: any;
  historyLength?: number;
  metadata?: any;
}

function mapMessages(messages: A2AMessage[] | undefined | null): any[] { // Use A2AMessage type
    if (!messages) return [];
    return messages.map((msg: A2AMessage) => ({ // Explicitly cast msg to A2AMessage
      ...msg,
      role: msg.role?.toUpperCase(), // Convert role to uppercase
      timestamp: msg.timestamp, // Include timestamp
      // Keep parts as is for now, assuming GraphQL handles JSONObject
    }));
  }

export const taskResolvers = {
    Query: {

      listTasks: async (_parent: any, { agentId }: { agentId: string }, context: ApolloContext, _info: any): Promise<any[]> => { // Changed return type to any[]
        // Using any[] for now to match AgentManager method, refine later if needed
        try {
          const rawTasks = await context.agentManager.getAgentTasks(agentId);
          console.log(`[Resolver listTasks] Fetched raw tasks for agent ${agentId}:`, rawTasks); // Original log

          // Filter tasks to ensure they have a valid state before mapping
          const validTasks = rawTasks.filter((task: any) => task?.state); // Check top-level state

          // Map tasks to the GraphQL Task type, combining and sorting messages
          const mappedTasks = validTasks.map((task: any) => {
            // Combine input and output messages and sort by timestamp
            // NOTE: After ka agent changes, task should have a 'messages' array directly.
            // We'll use that if available, otherwise fallback to combining input/output.
            const combinedMessages: A2AMessage[] = task.messages || [...(task.input || []), ...(task.output || [])]; // Explicitly type combinedMessages
            combinedMessages.sort((a: A2AMessage, b: A2AMessage) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()); // Add type annotations

            return {
              id: task.id,
              name: task.name, // Include the task name
              state: task.state.toUpperCase(), // Convert state to uppercase
              messages: mapMessages(combinedMessages), // Use the combined and sorted messages
              error: task.error,
              createdAt: task.created_at,
              updatedAt: task.updated_at,
              artifacts: task.artifacts, // Assuming artifacts matches directly (might need mapping)
              agentId: agentId, // Add agentId from the query arguments
              };
          });

          console.log(`[Resolver listTasks] Mapped tasks for agent ${agentId}:`, mappedTasks);
          return mappedTasks;
        } catch (error: any) {
          console.error(`[Resolver listTasks] Error fetching/mapping tasks for agent ${agentId}:`, error);
          // Re-throw the error so GraphQL client receives it
          // Wrap in GraphQLError for consistency
          throw new GraphQLError(`Failed to fetch tasks for agent ${agentId}: ${error.message}`, {
            extensions: { code: 'AGENT_COMMUNICATION_ERROR' },
            originalError: error
          });
        }
      },
    },

    Mutation: {
        createTask: async (_parent: any, args: CreateTaskArgs, context: ApolloContext, _info: any): Promise<any> => { // Changed return type to any
            // Destructure context as well
            const { agentId, sessionId, systemPrompt, message: inputMessage, pushNotification, historyLength, metadata } = args; // Include systemPrompt
            const { agentManager, eventEmitter } = context; // Get eventEmitter from context

            // --- 1. Determine Target Agent ---
            let selectedAgent: Agent | null = null;

            if (agentId) {
                console.log(`[GraphQL createTask] Requested for specific agent: ${agentId}`);
                selectedAgent = agentManager.getAgents().find((agent: Agent) => agent.id === agentId) || null; // Add type to agent
                if (!selectedAgent) {
                throw new GraphQLError(`Specified agent with ID ${agentId} not found.`, {
                    extensions: { code: 'AGENT_NOT_FOUND' },
                });
                }
                console.log(`[GraphQL createTask] Found specified agent: ${selectedAgent.name} at ${selectedAgent.url}`);
            } else {
                console.log('[GraphQL createTask] No specific agent ID provided, attempting discovery...');
                // Extract prompt for discovery (simplified)
                const firstTextPartContent = inputMessage.parts.find(part => part.type === 'text')?.content;
                const taskPrompt = firstTextPartContent?.text || JSON.stringify(inputMessage.parts.map(p => p.content)); // Fallback

                if (!taskPrompt || typeof taskPrompt !== 'string' || taskPrompt.trim() === '') {
                throw new GraphQLError('Could not extract a usable text prompt from task message for agent discovery.', {
                    extensions: { code: 'INVALID_INPUT', argumentName: 'message' },
                });
                }

                try {
                selectedAgent = await agentManager.findBestAgentForTask(taskPrompt);
                if (!selectedAgent) {
                    throw new GraphQLError('No suitable agent found for this task based on capabilities.', {
                    extensions: { code: 'NO_SUITABLE_AGENT' },
                    });
                }
                console.log(`[GraphQL createTask] Discovered best agent: ${selectedAgent.id} (${selectedAgent.name})`);
                } catch (error: any) {
                console.error(`[GraphQL createTask] Error during agent discovery:`, error);
                throw new GraphQLError(`Internal server error during agent discovery: ${error.message}`, {
                    extensions: { code: 'DISCOVERY_ERROR' },
                });
                }
            }

            if (!selectedAgent) {
                // Should be caught above, but as a safeguard
                throw new GraphQLError('Failed to determine target agent.', {
                extensions: { code: 'INTERNAL_ERROR' },
                });
            }

            // --- 2. Transform Input Message ---
            // Basic transformation assuming input Part.content structure matches output Part structure
            // Force the role to 'user' for the initial message sent to the agent.
            // Extract task name from the first text part of the input message
            const taskName = inputMessage.parts.find(part => part.type === 'text')?.content?.text || 'Unnamed Task';

            const taskMessage: A2AMessage = { // Use A2AMessage alias
                role: 'user', // Force role to 'user'
                parts: inputMessage.parts.map(part => ({
                type: part.type, // Pass type through
                // Spread the content object directly; assumes keys match (e.g., { type: 'text', content: { text: 'hello' } })
                ...(part.content as object),
                metadata: part.metadata,
                })) as A2APart[], // Use A2APart alias and cast
                metadata: inputMessage.metadata,
                timestamp: new Date().toISOString(), // Add current timestamp
            };


            // --- 3. Dispatch Task to Selected Agent ---
            try {
                console.log(`[GraphQL createTask] Dispatching task "${taskName}" to agent ${selectedAgent.id} (${selectedAgent.name}) at ${selectedAgent.url}`);
                const a2aClient = new A2AClient(selectedAgent.url);

                const paramsToSend: TaskSendParams = {
                name: taskName, // Include the extracted task name
                sessionId,
                systemPrompt, // Include the systemPrompt from arguments
                message: taskMessage,
                pushNotification,
                historyLength,
                metadata
                };

                const initialTask: A2ATask | null = await a2aClient.sendTask(paramsToSend); // Use A2ATask alias

                if (initialTask) {
                // Validate that the agent returned a status with a state
                if (!initialTask.status?.state) {
                    console.error(`[GraphQL createTask] Agent ${selectedAgent.id} returned initial task ${initialTask.id} without a valid state in status object:`, initialTask.status);
                    throw new GraphQLError(`Agent ${selectedAgent.id} returned invalid initial task data (missing state).`, {
                    extensions: { code: 'AGENT_RESPONSE_INVALID', agentId: selectedAgent.id },
                    });
                }

                // Convert nested state to uppercase to match schema
                const uppercaseState = initialTask.status.state.toUpperCase();

                // Map the structure for the GraphQL response.
                // Combine history and status.message (if present) and map to messages
                const combinedMessages: A2AMessage[] = [...(initialTask.history || []), ...(initialTask.status?.message ? [initialTask.status.message] : [])]; // Explicitly type combinedMessages
                    // Sort by timestamp (assuming timestamp is now present in A2AMessage due to ka agent changes)
                combinedMessages.sort((a: A2AMessage, b: A2AMessage) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()); // Add type annotations

                // Map the structure for the GraphQL response.
                const mappedInitialTask = {
                    id: initialTask.id,
                    state: uppercaseState, // Use the validated and converted state
                    name: taskName, // Include the task name
                    messages: mapMessages(combinedMessages), // Use the combined and sorted messages
                    error: initialTask.status?.state === 'failed' && initialTask.status?.message?.parts?.[0]?.type === 'text'
                            ? (initialTask.status.message.parts[0] as any).text // Access error message from status.message
                            : undefined,
                    createdAt: initialTask.status?.timestamp, // Map timestamp
                    updatedAt: initialTask.status?.timestamp, // Map timestamp
                    createdAtUnixMs: initialTask.status?.timestamp ? new Date(initialTask.status.timestamp).getTime() : Date.now(), // Add createdAtUnixMs
                    updatedAtUnixMs: initialTask.status?.timestamp ? new Date(initialTask.status.timestamp).getTime() : Date.now(), // Add updatedAtUnixMs
                    artifacts: initialTask.artifacts ? JSON.stringify(initialTask.artifacts) : undefined, // Map artifacts (needs proper mapping)
                    agentId: selectedAgent.id, // Add the selected agent's ID
                };
                return mappedInitialTask as any; // Cast needed due to structural differences
                } else {
                // Agent responded, but didn't return a valid task object (or returned error in JSON-RPC)
                    throw new GraphQLError(`Agent ${selectedAgent.id} accepted the task request but did not return valid initial task info.`, {
                    extensions: { code: 'AGENT_RESPONSE_INVALID', agentId: selectedAgent.id },
                    });
                }
            } catch (error: any) {
                console.error(`[GraphQL createTask] Error dispatching task to agent ${selectedAgent.id}:`, error);
                // Check if it's already a GraphQLError
                if (error instanceof GraphQLError) {
                    throw error;
                }
                // Wrap other errors
                throw new GraphQLError(`Internal server error during task dispatch: ${error.message}`, {
                extensions: { code: 'DISPATCH_ERROR', agentId: selectedAgent.id },
                originalError: error
                });
            }
            },
            deleteTask: async (_parent: any, { agentId, taskId }: { agentId: string, taskId: string }, context: ApolloContext, _info: any): Promise<boolean> => {
            const { agentManager } = context;
            console.log(`[GraphQL deleteTask] Received request for agent ${agentId}, task ${taskId}`);

            // 1. Find the agent
            const agent = agentManager.getAgents().find((a: Agent) => a.id === agentId);
            if (!agent) {
                console.error(`[GraphQL deleteTask] Agent with ID ${agentId} not found.`);
                throw new GraphQLError(`Agent with ID ${agentId} not found.`, {
                extensions: { code: 'AGENT_NOT_FOUND' },
                });
            }
            console.log(`[GraphQL deleteTask] Found agent: ${agent.name} at ${agent.url}`);

            // 2. Create A2A Client
            const a2aClient = new A2AClient(agent.url);

            // 3. Call delete task on the agent
            try {
                console.log(`[GraphQL deleteTask] Calling a2aClient.deleteTask for task ${taskId} on agent ${agentId}`);
                const success = await a2aClient.deleteTask(taskId);
                console.log(`[GraphQL deleteTask] a2aClient.deleteTask for task ${taskId} returned: ${success}`);
                return success;
            } catch (error: any) {
                console.error(`[GraphQL deleteTask] Error calling a2aClient.deleteTask for task ${taskId} on agent ${agentId}:`, error);
                // Wrap error in GraphQLError
                throw new GraphQLError(`Failed to delete task ${taskId} on agent ${agentId}: ${error.message}`, {
                extensions: { code: 'AGENT_COMMUNICATION_ERROR', agentId: agentId },
                originalError: error
                });
                }
            },
    }
}