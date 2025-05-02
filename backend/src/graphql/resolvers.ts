import { FastifyRequest, FastifyReply } from 'fastify';
import { AgentManager, Agent } from '../services/agentManager';
// Removed Orchestrator import
// Removed JSONObjectResolver import

interface ResolverContext {
  request: FastifyRequest;
  reply: FastifyReply;
  agentManager: AgentManager;
  // Removed orchestrator from context
}

// Removed orchestrator from function signature
export function createResolvers(agentManager: AgentManager) {
  return {
    // Removed JSONObject resolver
    Query: {
      agents: (_parent: any, _args: any, context: ResolverContext, _info: any): Agent[] => {
        return context.agentManager.getAgents();
      },
      agentLogs: (_parent: any, { agentId }: { agentId: string }, context: ResolverContext, _info: any): string[] | null => {
        const logs = context.agentManager.getAgentLogs(agentId);
        if (logs === null) {
          // Optionally throw a GraphQL error if agent not found
          // throw new Error(`Agent with ID ${agentId} not found or is not a local agent.`);
          return null; // Or return null/empty array as per schema
        }
        return logs;
      },
      // Removed getWorkflowStatus resolver
    },
    Mutation: {
      addAgent: (_parent: any, { url, name }: { url: string, name?: string }, context: ResolverContext, _info: any): Agent => {
        return context.agentManager.addRemoteAgent(url, name);
      },
      removeAgent: (_parent: any, { id }: { id: string }, context: ResolverContext, _info: any): boolean => {
        return context.agentManager.removeAgent(id);
      },
      spawnKaAgent: async (_parent: any, args: { model?: string, systemPrompt?: string, apiBaseUrl?: string, port?: number | null, name?: string, description?: string }, context: ResolverContext, _info: any): Promise<Agent | null> => {
        return context.agentManager.spawnLocalAgent(args);
      },
      stopKaAgent: (_parent: any, { id }: { id: string }, context: ResolverContext, _info: any): boolean => {
        return context.agentManager.stopLocalAgent(id);
      },
      // Removed startWorkflow resolver
      // Removed stopWorkflow resolver
     },
   };
}
