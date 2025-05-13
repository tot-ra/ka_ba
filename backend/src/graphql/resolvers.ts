import { EventEmitter } from 'node:events'; // Import EventEmitter
import { AgentManager } from '../services/agentManager.js';
import { Agent } from '../services/agentRegistry.js'; // Import Agent from agentRegistry
import { Task as A2ATask, Message as A2AMessage } from '../a2aClient.js'; // Alias A2A types
import { JSONObjectResolver, DateTimeResolver } from 'graphql-scalars';
import { GraphQLError } from 'graphql';
import { ApolloContext } from './server.js';
import { Repeater } from '@repeaterjs/repeater'; // Import Repeater for AsyncIterator creation
import axios from 'axios'; // Import axios for HTTP calls to ka agent
import { readMcpServers } from '../services/mcpServerService.js'; // Import MCP server service functions and fetchCapabilities
import { kaAgentResolvers } from './kaAgentResolvers.js';
import { mcpServersResolvers } from './mcpServersResolvers.js';
import { taskResolvers } from './taskResolvers.js';

// Define the payload structure for the agentLogs subscription
export interface LogEntryPayload {
  timestamp: string; // ISO timestamp string
  stream: 'stdout' | 'stderr';
  line: string;
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
      ...kaAgentResolvers.Query,
      ...mcpServersResolvers.Query,
      ...taskResolvers.Query,

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
    },
    Mutation: {
      ...mcpServersResolvers.Mutation,
      ...taskResolvers.Mutation,
      ...kaAgentResolvers.Mutation,
      
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
