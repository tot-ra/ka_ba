import { EventEmitter } from 'node:events'; // Import EventEmitter
import { AgentManager } from '../services/agentManager.js';
import { Agent } from '../services/agentRegistry.js'; // Import Agent from agentRegistry
import { A2AClient, TaskSendParams, Task as A2ATask, Message as A2AMessage, Part as A2APart } from '../a2aClient.js'; // Alias A2A types
import { JSONObjectResolver, DateTimeResolver } from 'graphql-scalars';
import { GraphQLError } from 'graphql';
import { ApolloContext } from './server.js';
import { Repeater } from '@repeaterjs/repeater'; // Import Repeater for AsyncIterator creation
import axios from 'axios'; // Import axios for HTTP calls to ka agent
import { readMcpServers, writeMcpServers, fetchMcpServerCapabilities } from '../services/mcpServerService.js'; // Import MCP server service functions and fetchCapabilities

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

// Define the structure for ToolDefinition to match the schema
interface ToolDefinition {
  name: string;
  description: string;
}

// Define the structure for McpServerConfig to match the schema
interface McpServerConfig {
  name: string;
  timeout: number;
  command: string;
  args: string[];
  transportType: string;
  env: { [key: string]: string };
  tools: ToolDefinition[]; // Add tools field
  resources: string[]; // Add resources field
}

// Define interface for addMcpServer mutation arguments
interface AddMcpServerArgs {
  server: McpServerConfig;
}


// Update function signature to accept eventEmitter
export function createResolvers(agentManager: AgentManager, eventEmitter: EventEmitter) {
// Helper function to map messages and convert roles (Define once here)
function mapMessages(messages: A2AMessage[] | undefined | null): any[] { // Use A2AMessage type
  if (!messages) return [];
  return messages.map((msg: A2AMessage) => ({ // Explicitly cast msg to A2AMessage
    ...msg,
    role: msg.role?.toUpperCase(), // Convert role to uppercase
    timestamp: msg.timestamp, // Include timestamp
    // Keep parts as is for now, assuming GraphQL handles JSONObject
  }));
}

  return {
    JSONObject: JSONObjectResolver,
    DateTime: DateTimeResolver,
    Query: {
      agents: (_parent: any, _args: any, context: ApolloContext, _info: any): Agent[] => {
        return context.agentManager.getAgents();
      },
      // Resolver to fetch a single agent by ID
      agent: (_parent: any, { id }: { id: string }, context: ApolloContext, _info: any): Agent | undefined => {
        console.log(`[Resolver agent] Fetching agent with ID: ${id}`);
        const agent = context.agentManager.getAgents().find((a: Agent) => a.id === id);
        if (!agent) {
          console.warn(`[Resolver agent] Agent with ID ${id} not found.`);
        } else {
          console.log(`[Resolver agent] Found agent: ${agent.name}`);
        }
        return agent;
      },
      agentLogs: (_parent: any, { agentId }: { agentId: string }, context: ApolloContext, _info: any): string[] | null => {
        // This query remains for fetching historical logs if needed, but real-time is via subscription
        const logs = context.agentManager.getAgentLogs(agentId);
        if (logs === null) {
          // Optionally throw a GraphQL error if agent not found or not local
          // throw new GraphQLError(`Agent with ID ${agentId} not found or is not a local agent.`, { extensions: { code: 'AGENT_NOT_FOUND' } });
          return null; // Or return null/empty array as per schema
        }
        return logs;
      },
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
      // New resolver to list available tools for a specific agent
      availableTools: async (_parent: any, { agentId }: { agentId: string }, context: ApolloContext, _info: any): Promise<ToolDefinition[]> => {
        const { agentManager } = context;

        // 1. Find the agent
        const agent = agentManager.getAgents().find((a: Agent) => a.id === agentId);
        if (!agent) {
          throw new GraphQLError(`Agent with ID ${agentId} not found.`, {
            extensions: { code: 'AGENT_NOT_FOUND' },
          });
        }

        // 2. Check if the agent supports the /tools endpoint (optional but good practice)
        // This would require the agent card to expose this endpoint.
        // For now, we'll assume ka agents support it and just call the endpoint.

        // 3. Call the agent's /tools HTTP endpoint
        try {
          const toolsUrl = `${agent.url.replace(/\/+$/, '')}/tools`; // Ensure no double slash
          console.log(`[GraphQL availableTools] Fetching tools from agent ${agentId} at ${toolsUrl}`);
          const response = await axios.get<ToolDefinition[]>(toolsUrl);

          if (response.status !== 200 || !Array.isArray(response.data)) {
             console.error(`[GraphQL availableTools] Unexpected response from agent ${agentId} /tools endpoint: Status ${response.status}, Data:`, response.data);
             throw new GraphQLError(`Agent ${agentId} returned invalid data from /tools endpoint.`, {
               extensions: { code: 'AGENT_RESPONSE_INVALID', agentId: agentId },
             });
          }

          console.log(`[GraphQL availableTools] Received ${response.data.length} tools from agent ${agentId}.`);
          return response.data; // Return the array of ToolDefinition
        } catch (error: any) {
          console.error(`[GraphQL availableTools] Error fetching tools from agent ${agentId}:`, error);
          // Log the original error details for debugging
          if (error.response) {
            console.error(`[GraphQL availableTools] Agent response status: ${error.response.status}`);
            console.error(`[GraphQL availableTools] Agent response data:`, error.response.data);
            console.error(`[GraphQL availableTools] Agent response headers:`, error.response.headers);
          } else if (error.request) {
            console.error(`[GraphQL availableTools] No response received from agent. Request details:`, error.request);
          } else {
            console.error(`[GraphQL availableTools] Error setting up the request to agent:`, error.message);
          }
          // Wrap error in GraphQLError
          throw new GraphQLError(`Failed to fetch available tools from agent ${agentId}: ${error.message}`, {
            extensions: { code: 'AGENT_COMMUNICATION_ERROR', agentId: agentId, originalError: { message: error.message, stack: error.stack, responseStatus: error.response?.status, responseData: error.response?.data } },
            originalError: error
          });
        }
      },
      // Resolver to fetch all MCP servers
      mcpServers: async (_parent: any, _args: any, _context: ApolloContext, _info: any): Promise<McpServerConfig[]> => {
        try {
          const servers = await readMcpServers();
          return servers;
        } catch (error: any) {
          console.error('Error adding MCP server:', error);
          throw new GraphQLError('Failed to add MCP server', {
            extensions: { code: 'INTERNAL_SERVER_ERROR' },
            originalError: error,
          });
        }
      },
    },
    Mutation: {
      addAgent: (_parent: any, { url, name }: { url: string, name?: string }, context: ApolloContext, _info: any): Agent => {
        return context.agentManager.addRemoteAgent(url, name);
      },
      removeAgent: (_parent: any, { id }: { id: string }, context: ApolloContext, _info: any): boolean => {
        return context.agentManager.removeAgent(id);
      },
      spawnKaAgent: async (_parent: any, args: { model?: string, systemPrompt?: string, apiBaseUrl?: string, port?: number | null, name?: string, description?: string }, context: ApolloContext, _info: any): Promise<Agent | null> => {
        const spawnedAgent = await context.agentManager.spawnLocalAgent(args);

        if (spawnedAgent) {
          try {
            // Read MCP server configurations
            const mcpServers = await readMcpServers();
            console.log(`[GraphQL spawnKaAgent] Read ${mcpServers.length} MCP server configurations.`);

            if (mcpServers.length > 0) {
              // Send MCP configurations to the spawned agent
              const setConfigUrl = `${spawnedAgent.url.replace(/\/+$/, '')}/set-mcp-config`;
              console.log(`[GraphQL spawnKaAgent] Sending MCP configurations to agent at ${setConfigUrl}`);
              const setConfigResponse = await axios.post(setConfigUrl, mcpServers); // Send as JSON array
              console.log(`[GraphQL spawnKaAgent] Successfully sent MCP configurations to agent ${spawnedAgent.id}. Status: ${setConfigResponse.status}`);
              console.log(`[GraphQL spawnKaAgent] Response data from /set-mcp-config:`, setConfigResponse.data);

            } else {
              console.log(`[GraphQL spawnKaAgent] No MCP server configurations to send to agent ${spawnedAgent.id}.`);
            }
          } catch (error: any) {
            console.error(`[GraphQL spawnKaAgent] Error sending MCP configurations to agent ${spawnedAgent.id}:`, error);
            // Log the original error details for debugging
            if (error.response) {
              console.error(`[GraphQL spawnKaAgent] Agent response status: ${error.response.status}`);
              console.error(`[GraphQL spawnKaAgent] Agent response data:`, error.response.data);
              console.error(`[GraphQL spawnKaAgent] Agent response headers:`, error.response.headers);
            } else if (error.request) {
              console.error(`[GraphQL spawnKaAgent] No response received from agent. Request details:`, error.request);
            } else {
              console.error(`[GraphQL spawnKaAgent] Error setting up the request to agent:`, error.message);
            }
            // Decide how to handle this error: fail the spawn mutation or just log a warning?
            // For now, we'll log a warning and return the agent, as the agent might still function without MCP tools.
            // A more robust solution might require the agent to confirm config received.
          }
        }

        return spawnedAgent;
      },
      stopKaAgent: (_parent: any, { id }: { id: string }, context: ApolloContext, _info: any): boolean => {
        // Use removeAgent which handles stopping local agents internally
        return context.agentManager.removeAgent(id);
      },
      // New resolver to update an agent's system prompt
      updateAgentSystemPrompt: async (_parent: any, { agentId, systemPrompt }: { agentId: string, systemPrompt: string }, context: ApolloContext, _info: any): Promise<Agent> => {
        const { agentManager } = context;
        try {
          const updatedAgent = await agentManager.updateAgentSystemPrompt(agentId, systemPrompt);
          return updatedAgent;
        } catch (error: any) {
          console.error(`[GraphQL updateAgentSystemPrompt] Error updating system prompt for agent ${agentId}:`, error);
          throw new GraphQLError(`Failed to update system prompt for agent ${agentId}: ${error.message}`, {
            extensions: { code: 'AGENT_UPDATE_ERROR', agentId: agentId },
            originalError: error
          });
        }
      },
      // New resolver to compose system prompt
      composeSystemPrompt: async (_parent: any, { agentId, toolNames, mcpServerNames }: { agentId: string, toolNames: string[], mcpServerNames: string[] }, context: ApolloContext, _info: any): Promise<string> => {
         const { agentManager } = context;

         // 1. Find the agent
         const agent = agentManager.getAgents().find((a: Agent) => a.id === agentId);
         if (!agent) {
           throw new GraphQLError(`Agent with ID ${agentId} not found.`, {
             extensions: { code: 'AGENT_NOT_FOUND' },
           });
         }

         // 2. Fetch the full McpServerConfig objects for the selected names
         let selectedMcpServers: McpServerConfig[] = [];
         try {
           const allMcpServers = await readMcpServers();
           selectedMcpServers = allMcpServers.filter(server => mcpServerNames.includes(server.name));
           console.log(`[GraphQL composeSystemPrompt] Found ${selectedMcpServers.length} selected MCP servers.`);
         } catch (error: any) {
           console.error('[GraphQL composeSystemPrompt] Error fetching MCP servers:', error);
           // Continue without MCP servers if fetching fails
         }

         // NEW STEP: Send ALL MCP configurations to the agent before composing the prompt
         try {
            const allMcpServers = await readMcpServers(); // Re-read all servers
            if (allMcpServers.length > 0) {
              const setConfigUrl = `${agent.url.replace(/\/+$/, '')}/set-mcp-config`;
              console.log(`[GraphQL composeSystemPrompt] Sending ALL ${allMcpServers.length} MCP configurations to agent ${agentId} at ${setConfigUrl} before composing prompt.`);
              // Send the full list of all configured MCP servers
              const setConfigResponse = await axios.post(setConfigUrl, allMcpServers);
              console.log(`[GraphQL composeSystemPrompt] Successfully sent ALL MCP configurations to agent ${agentId}. Status: ${setConfigResponse.status}`);
              console.log(`[GraphQL composeSystemPrompt] Response data from /set-mcp-config (during compose):`, setConfigResponse.data);
            } else {
               console.log(`[GraphQL composeSystemPrompt] No MCP server configurations to send to agent ${agentId} before composing prompt.`);
            }
         } catch (error: any) {
            console.error(`[GraphQL composeSystemPrompt] Error sending ALL MCP configurations to agent ${agentId} before composing prompt:`, error);
            // Log the original error details for debugging
            if (error.response) {
              console.error(`[GraphQL composeSystemPrompt] Agent response status (during compose): ${error.response.status}`);
              console.error(`[GraphQL composeSystemPrompt] Agent response data (during compose):`, error.response.data);
            } else if (error.request) {
              console.error(`[GraphQL composeSystemPrompt] No response received from agent (during compose). Request details:`, error.request);
            } else {
              console.error(`[GraphQL composeSystemPrompt] Error setting up the request to agent (during compose):`, error.message);
            }
            // Decide how to handle this error: proceed with composing prompt or fail?
            // For now, we'll log a warning and proceed, as the agent might still compose a prompt without updated MCP tools.
         }


         // 3. Call the agent's /compose-prompt HTTP endpoint with the selected tool names and full MCP server configs
         try {
           const composeUrl = `${agent.url.replace(/\/+$/, '')}/compose-prompt`; // Ensure no double slash
           const selectedMcpServerNames = selectedMcpServers.map(s => s.name)
           console.log(`[GraphQL composeSystemPrompt] Composing prompt for agent ${agentId} at ${composeUrl} with tools:`, toolNames, 'and selected MCP servers:', selectedMcpServerNames);
           // Pass the full selectedMcpServers array to the agent
           const response = await axios.post<{ systemPrompt: string }>(composeUrl, { toolNames, mcpServerNames: selectedMcpServerNames }); // Send object with both arrays in body

           if (response.status !== 200 || typeof response.data?.systemPrompt !== 'string') {
              console.error(`[GraphQL composeSystemPrompt] Unexpected response from agent ${agentId} /compose-prompt endpoint: Status ${response.status}, Data:`, response.data);
              throw new GraphQLError(`Agent ${agentId} returned invalid data from /compose-prompt endpoint.`, {
                extensions: { code: 'AGENT_RESPONSE_INVALID', agentId: agentId },
              });
           }

           console.log(`[GraphQL composeSystemPrompt] Received composed prompt from agent ${agentId}.`, response.data);
           return response.data.systemPrompt; // Return the composed system prompt string
         } catch (error: any) {
           console.error(`[GraphQL composeSystemPrompt] Error composing prompt for agent ${agentId}:`, error);
           // Wrap error in GraphQLError
           throw new GraphQLError(`Failed to compose system prompt from agent ${agentId}: ${error.message}`, {
             extensions: { code: 'AGENT_COMMUNICATION_ERROR', agentId: agentId },
             originalError: error
           });
         }
      },
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

      addMcpServer: async (_parent: any, { server }: AddMcpServerArgs, _context: ApolloContext, _info: any): Promise<McpServerConfig> => {
        try {
          // Fetch capabilities before saving
          const capabilities = await fetchMcpServerCapabilities(server);
          const serverWithCapabilities = { ...server, ...capabilities }; // Merge capabilities into server object

          const servers = await readMcpServers();
          servers.push(serverWithCapabilities); // Push server with capabilities
          await writeMcpServers(servers);
          return serverWithCapabilities; // Return server with capabilities
        }
        catch (error: any) {
          console.error('Error adding MCP server:', error);
          throw new GraphQLError('Failed to add MCP server', {
            extensions: { code: 'INTERNAL_SERVER_ERROR' },
            originalError: error,
          });
        }
      },

      // Resolver to edit an existing MCP server
      editMcpServer: async (_parent: any, { name, server }: { name: string, server: McpServerConfig }, _context: ApolloContext, _info: any): Promise<McpServerConfig> => {
        try {
          const servers = await readMcpServers();
          const serverIndex = servers.findIndex(s => s.name === name);
          if (serverIndex === -1) {
            throw new GraphQLError(`MCP server with name "${name}" not found.`, {
              extensions: { code: 'NOT_FOUND' },
            });
          }

          // Fetch capabilities for the updated server config
          const capabilities = await fetchMcpServerCapabilities(server);
          const serverWithCapabilities = { ...server, ...capabilities }; // Merge capabilities into server object

          servers[serverIndex] = serverWithCapabilities; // Replace with server with capabilities
          await writeMcpServers(servers);
          return serverWithCapabilities; // Return server with capabilities
        } catch (error: any) {
          console.error(`Error editing MCP server "${name}":`, error);
          throw new GraphQLError(`Failed to edit MCP server "${name}"`, {
            extensions: { code: 'INTERNAL_SERVER_ERROR' },
            originalError: error,
          });
        }
      },

      // Resolver to delete an MCP server
      deleteMcpServer: async (_parent: any, { name }: { name: string }, _context: ApolloContext, _info: any): Promise<boolean> => {
        try {
          const servers = await readMcpServers();
          const initialLength = servers.length;
          const updatedServers = servers.filter(s => s.name !== name);
          if (updatedServers.length === initialLength) {
             throw new GraphQLError(`MCP server with name "${name}" not found.`, {
               extensions: { code: 'NOT_FOUND' },
             });
          }
          await writeMcpServers(updatedServers);
          return true;
        } catch (error: any) {
          console.error(`Error deleting MCP server "${name}":`, error);
          throw new GraphQLError(`Failed to delete MCP server "${name}"`, {
            extensions: { code: 'INTERNAL_SERVER_ERROR' },
            originalError: error,
          });
        }
      },
    },
      Subscription: {
        agentLogs: {
          // Define the subscription topic dynamically based on agentId
          subscribe: (_parent: any, { agentId }: { agentId: string }, context: ApolloContext, _info: any) => {
            console.log(`[Resolver agentLogs subscribe] Client attempting to subscribe to logs for agent: ${agentId}`); // Added log
            // Check if agent exists and is local? Optional, agentManager handles logs only for local agents.
            const agent = context.agentManager.getAgents().find((a: Agent) => a.id === agentId); // Add type to a
            if (!agent) {
              // Or throw error immediately? Let's allow subscription but it might never receive messages.
              console.warn(`[Resolver agentLogs] Subscription requested for non-existent agent ID: ${agentId}`);
              // Alternatively, throw new GraphQLError(`Agent with ID ${agentId} not found.`, { extensions: { code: 'AGENT_NOT_FOUND' } });
            } else if (!agent.isLocal) {
              console.warn(`[Resolver agentLogs] Subscription requested for non-local agent ID: ${agentId}`);
              // Alternatively, throw new GraphQLError(`Agent with ID ${agentId} is not a local agent and does not support log streaming.`, { extensions: { code: 'AGENT_NOT_LOCAL' } });
            }

            const topic = `AGENT_LOG_${agentId}`;
            console.log(`[Resolver agentLogs subscribe] Client subscribing to event topic: ${topic}`);

            // Use Repeater to create an AsyncIterator from EventEmitter events
            return new Repeater<LogEntryPayload>(async (push, stop) => {
              const listener = (payload: LogEntryPayload) => {
                console.log(`[Resolver agentLogs listener] Event received on topic ${topic}:`, payload);
                push(payload); // Push the received payload to the iterator
              };

              context.eventEmitter.on(topic, listener); // Start listening
              console.log(`[Resolver agentLogs subscribe] Attached listener to topic ${topic}`);

              // stop.then is called when the client disconnects
              await stop;

              context.eventEmitter.off(topic, listener); // Clean up listener
              console.log(`[Resolver agentLogs subscribe] Removed listener from topic ${topic} on disconnect`);
            });
          },
          // Resolve function is simpler now, just returns the payload pushed by the Repeater
          resolve: (payload: LogEntryPayload) => {
            // console.log("[Resolver agentLogs resolve] Forwarding payload:", payload); // Log can be less verbose now
            return payload; // The payload is already the correct LogEntry type
          },
        },
        // Add other subscriptions here if needed (e.g., taskUpdates)
        taskUpdates: {
          subscribe: (_parent: any, { agentId, taskId }: { agentId: string, taskId?: string }, context: ApolloContext, _info: any) => {
            console.log(`[Resolver taskUpdates subscribe] Client attempting to subscribe to task updates for agent: ${agentId}, task: ${taskId || 'ALL'}`);

            // Determine the topic based on agentId and optional taskId
            const topic = taskId ? `TASK_UPDATE_${agentId}_${taskId}` : `TASK_UPDATE_${agentId}_ALL`;
            console.log(`[Resolver taskUpdates subscribe] Client subscribing to event topic: ${topic}`);

            return new Repeater<any>(async (push, stop) => { // Changed Repeater type to any
              const listener = (payload: A2ATask) => { // Listener receives A2ATask payload
                console.log(`[Resolver taskUpdates listener] Event received on topic ${topic}:`, payload);

                // Combine history and status.message (if present) and map to messages
                const combinedMessages: A2AMessage[] = [...(payload.history || []), ...(payload.status?.message ? [payload.status.message] : [])]; // Explicitly type combinedMessages
                // Sort by timestamp (assuming timestamp is now present in A2AMessage due to ka agent changes)
                combinedMessages.sort((a: A2AMessage, b: A2AMessage) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()); // Add type annotations

                // Map the structure for the GraphQL response.
                const mappedTask = {
                  id: payload.id, // Assuming ID is top-level
                  state: payload.status?.state?.toUpperCase(), // Access state from status and convert to uppercase
                  messages: mapMessages(combinedMessages), // Use the combined and sorted messages
                  error: payload.status?.state === 'failed' && payload.status?.message?.parts?.[0]?.type === 'text'
                         ? (payload.status.message.parts[0] as any).text // Access error message from status.message
                         : undefined,
                  createdAt: payload.status?.timestamp, // Map timestamp from status
                  updatedAt: payload.status?.timestamp, // Map timestamp from status
                  artifacts: payload.artifacts, // Assuming artifacts matches directly
                  agentId: agentId, // Add agentId from the subscription arguments
              };
              push(mappedTask as any); // Push the mapped payload to the iterator
              };

            context.eventEmitter.on(topic, listener); // Start listening
            console.log(`[Resolver taskUpdates subscribe] Attached listener to topic ${topic}`);

            // stop.then is called when the client disconnects
            await stop;

            context.eventEmitter.off(topic, listener); // Clean up listener
            console.log(`[Resolver taskUpdates subscribe] Removed listener from topic ${topic} on disconnect`);
            });
        },
        resolve: (payload: any) => { // Changed resolve payload type to any
          // The payload is already mapped in the subscribe function
          return payload;
        },
      },
      },
    };
    }
