import { AgentManager } from '../services/agentManager.js';
import { Agent } from '../services/agentRegistry.js';
import axios from 'axios';
import { readMcpServers } from '../services/mcpServerService.js';
import { ApolloContext } from './server.js';

// Define the structure for McpServerConfig to match the schema
interface McpServerConfig {
  name: string;
  timeout: number;
  command: string;
  args: string[];
  transportType: string;
  env: { [key: string]: string };
  tools: any[]; // Add tools field
  resources: string[]; // Add resources field
}

export const kaAgentResolvers = {
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
  },
  Mutation: {
    spawnKaAgent: async (_parent: any, args: { model?: string, systemPrompt?: string, apiBaseUrl?: string, port?: number | null, name?: string, description?: string }, context: { agentManager: AgentManager }, _info: any): Promise<Agent | null> => {
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

    addAgent: (_parent: any, { url, name }: { url: string, name?: string }, context: ApolloContext, _info: any): Agent => {
      return context.agentManager.addRemoteAgent(url, name);
    },
    removeAgent: (_parent: any, { id }: { id: string }, context: ApolloContext, _info: any): boolean => {
      return context.agentManager.removeAgent(id);
    },

    stopKaAgent: (_parent: any, { id }: { id: string }, context: ApolloContext, _info: any): boolean => {
      // Use removeAgent which handles stopping local agents internally
      return context.agentManager.removeAgent(id);
    },
  },


};
