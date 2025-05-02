import { FastifyRequest, FastifyReply } from 'fastify';
import { PubSub } from 'graphql-subscriptions'; // Import PubSub
import { AgentManager, Agent } from '../services/agentManager.js'; // Add .js extension
import { A2AClient, TaskSendParams, Task, Message, Part } from '../a2aClient.js'; // Add .js extension
import { JSONObjectResolver, DateTimeResolver } from 'graphql-scalars'; // Import DateTimeResolver
import { GraphQLError } from 'graphql'; // Import GraphQLError for better error handling
import { ApolloContext } from './server.js'; // Add .js extension

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


// Update function signature to accept pubsub
export function createResolvers(agentManager: AgentManager, pubsub: PubSub) {
  return {
    JSONObject: JSONObjectResolver, // Re-add JSONObject resolver
    DateTime: DateTimeResolver, // Add DateTime scalar resolver
    Query: {
      agents: (_parent: any, _args: any, context: ApolloContext, _info: any): Agent[] => {
        return context.agentManager.getAgents();
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
      listTasks: async (_parent: any, { agentId }: { agentId: string }, context: ApolloContext, _info: any): Promise<any[]> => {
        // Using any[] for now to match AgentManager method, refine later if needed
        try {
          return await context.agentManager.getAgentTasks(agentId);
        } catch (error: any) {
          console.error(`[Resolver listTasks] Error fetching tasks for agent ${agentId}:`, error);
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
      addAgent: (_parent: any, { url, name }: { url: string, name?: string }, context: ApolloContext, _info: any): Agent => {
        return context.agentManager.addRemoteAgent(url, name);
      },
      removeAgent: (_parent: any, { id }: { id: string }, context: ApolloContext, _info: any): boolean => {
        return context.agentManager.removeAgent(id);
      },
      spawnKaAgent: async (_parent: any, args: { model?: string, systemPrompt?: string, apiBaseUrl?: string, port?: number | null, name?: string, description?: string }, context: ApolloContext, _info: any): Promise<Agent | null> => {
        return context.agentManager.spawnLocalAgent(args);
      },
      stopKaAgent: (_parent: any, { id }: { id: string }, context: ApolloContext, _info: any): boolean => {
        return context.agentManager.stopLocalAgent(id);
      },
      createTask: async (_parent: any, args: CreateTaskArgs, context: ApolloContext, _info: any): Promise<Task> => {
        // Destructure context as well
        const { agentId, sessionId, message: inputMessage, pushNotification, historyLength, metadata } = args;
        const { agentManager, pubsub } = context; // Get pubsub from context

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
        const taskMessage: Message = {
          role: inputMessage.role,
          parts: inputMessage.parts.map(part => ({
            type: part.type, // Pass type through
            // Spread the content object directly; assumes keys match (e.g., { type: 'text', content: { text: 'hello' } })
            ...(part.content as object),
            metadata: part.metadata,
          })) as Part[], // Cast needed here, potentially unsafe depending on input validation
          metadata: inputMessage.metadata,
        };


        // --- 3. Dispatch Task to Selected Agent ---
        try {
          console.log(`[GraphQL createTask] Dispatching task to agent ${selectedAgent.id} (${selectedAgent.name}) at ${selectedAgent.url}`);
          const a2aClient = new A2AClient(selectedAgent.url);

          const paramsToSend: TaskSendParams = {
            sessionId,
            message: taskMessage,
            pushNotification,
            historyLength,
            metadata
          };

          const initialTask: Task | null = await a2aClient.sendTask(paramsToSend);

          if (initialTask) {
            // The schema expects a Task, which initialTask should be.
            // We don't add assignedAgentId here as it's not in the GraphQL Task type.
            return initialTask;
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
     },
     Subscription: {
        agentLogs: {
          // Define the subscription topic dynamically based on agentId
          subscribe: (_parent: any, { agentId }: { agentId: string }, context: ApolloContext, _info: any) => {
            console.log(`[Resolver agentLogs] Client subscribing to logs for agent: ${agentId}`);
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

            // Subscribe to the specific agent's log topic
            // The payload published to this topic should be LogEntryPayload
            // Cast to 'any' as a last resort to bypass type checking for this method call
            return (context.pubsub as any).asyncIterator(`AGENT_LOG_${agentId}`);
          },
          // The resolve function maps the published payload to the GraphQL type
          resolve: (payload: LogEntryPayload) => {
             // The payload *is* the LogEntry structure defined in the schema
             return payload;
          }
        },
        // Add other subscriptions here if needed (e.g., taskUpdates)
     },
   };
}
