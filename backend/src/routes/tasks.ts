import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AgentManager, Agent } from '../services/agentManager'; // Import Agent type
import { A2AClient, TaskSendParams, Task, Message, Part } from '../a2aClient'; // Import necessary types

// Define the expected request body structure, including optional agentId
interface CreateTaskRequestBody extends Partial<TaskSendParams> {
  agentId?: string;
}

export function registerTasksRoutes(fastify: FastifyInstance, agentManager: AgentManager) {

  // Removed the POST /api/tasks/create endpoint as it's replaced by the GraphQL mutation

  // Endpoint to list tasks for a specific agent (Kept as REST for now, could be moved to GraphQL Query later)
  fastify.get('/api/agents/:agentId/tasks', async (request: FastifyRequest<{ Params: { agentId: string } }>, reply: FastifyReply) => {
    const { agentId } = request.params;

    if (!agentId) {
      reply.code(400).send({ error: 'Missing agentId parameter' });
      return;
    }

    const selectedAgent = agentManager.getAgents().find(agent => agent.id === agentId);

    if (!selectedAgent) {
      reply.code(404).send({ error: `Agent with ID ${agentId} not found` });
      return;
    }

    console.log(`[Tasks Route] Found agent ${agentId}: URL = ${selectedAgent.url}, Name = ${selectedAgent.name}`); // Log the agent URL

    const a2aClient = new A2AClient(selectedAgent.url);

    try {
      console.log(`[Tasks Route] Attempting to list tasks from agent ${agentId} at ${selectedAgent.url}`); // Log before calling
      const tasks = await a2aClient.listTasks();
      if (tasks !== null) {
        reply.send(tasks);
      } else {
        reply.code(500).send({ error: `Failed to list tasks from agent ${agentId}` });
      }
    } catch (error: any) {
      console.error(`Error proxying listTasks for agent ${agentId}:`, error);
      reply.code(500).send({ error: { code: -32603, message: `Internal server error during listTasks proxy for agent ${agentId}`, data: error.message } });
    }
  });
}
