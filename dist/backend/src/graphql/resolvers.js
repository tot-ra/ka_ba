"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createResolvers = createResolvers;
const schema_1 = require("./schema"); // Re-add JSONObjectResolver import
// Removed orchestrator from function signature
function createResolvers(agentManager) {
    return {
        JSONObject: schema_1.JSONObjectResolver, // Re-add JSONObject resolver
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
            listTasks: async (_parent, { agentId }, context, _info) => {
                // Using any[] for now to match AgentManager method, refine later if needed
                try {
                    return await context.agentManager.getAgentTasks(agentId);
                }
                catch (error) {
                    console.error(`[Resolver listTasks] Error fetching tasks for agent ${agentId}:`, error);
                    // Re-throw the error so GraphQL client receives it
                    throw new Error(`Failed to fetch tasks for agent ${agentId}: ${error.message}`);
                }
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
