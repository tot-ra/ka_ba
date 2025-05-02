"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createResolvers = createResolvers;
// Removed orchestrator from function signature
function createResolvers(agentManager) {
    return {
        // Removed JSONObject resolver
        Query: {
            agents: (_parent, _args, context, _info) => {
                return context.agentManager.getAgents();
            },
            agentLogs: (_parent, { agentId }, context, _info) => {
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
            addAgent: (_parent, { url, name }, context, _info) => {
                return context.agentManager.addRemoteAgent(url, name);
            },
            removeAgent: (_parent, { id }, context, _info) => {
                return context.agentManager.removeAgent(id);
            },
            spawnKaAgent: async (_parent, args, context, _info) => {
                return context.agentManager.spawnLocalAgent(args);
            },
            stopKaAgent: (_parent, { id }, context, _info) => {
                return context.agentManager.stopLocalAgent(id);
            },
            // Removed startWorkflow resolver
            // Removed stopWorkflow resolver
        },
    };
}
