"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTasksRoutes = registerTasksRoutes;
const a2aClient_1 = require("../a2aClient"); // Import necessary types, including Message and Part
function registerTasksRoutes(fastify, agentManager) {
    // Endpoint to create and dispatch a task using dynamic discovery
    // Explicitly type the Body as Partial<TaskSendParams> as the client likely won't send an ID
    fastify.post('/api/tasks/create', async (request, reply) => {
        // Validate the incoming body structure more carefully
        const body = request.body;
        if (!body || typeof body !== 'object' || !body.message || !Array.isArray(body.message.parts) || body.message.parts.length === 0) {
            reply.code(400).send({ error: 'Invalid task parameters. Request body must contain a message object with a non-empty parts array.' });
            return;
        }
        // Cast to the expected type after validation
        const taskMessage = body.message;
        // Extract text prompt for discovery (simplistic: assumes first text part)
        // Explicitly type 'part' here
        const firstTextPart = taskMessage.parts.find((part) => part.type === 'text');
        // Use 'as any' temporarily if firstTextPart type is complex or use type guard
        const taskPrompt = firstTextPart?.text || JSON.stringify(taskMessage.parts); // Fallback to stringified parts
        if (!taskPrompt || typeof taskPrompt !== 'string' || taskPrompt.trim() === '') {
            reply.code(400).send({ error: 'Could not extract a usable text prompt from task parameters for agent discovery.' });
            return;
        }
        try {
            const bestAgent = await agentManager.findBestAgentForTask(taskPrompt);
            if (!bestAgent) {
                reply.code(404).send({ error: 'No suitable agent found for this task based on capabilities.' });
                return;
            }
            console.log(`Dispatching task to agent ${bestAgent.id} (${bestAgent.name}) at ${bestAgent.url}`);
            const a2aClient = new a2aClient_1.A2AClient(bestAgent.url);
            // Construct the parameters for sendTask, ensuring it matches TaskSendParams
            // Crucially, we likely *don't* send an ID, letting the agent generate it.
            const paramsToSend = {
                // id: undefined, // Explicitly undefined or omitted
                sessionId: body.sessionId, // Pass through if provided
                message: taskMessage,
                pushNotification: body.pushNotification, // Pass through if provided
                historyLength: body.historyLength, // Pass through if provided
                metadata: body.metadata // Pass through if provided
            };
            const initialTask = await a2aClient.sendTask(paramsToSend);
            if (initialTask) {
                // Return the initial task info, potentially adding which agent it was assigned to
                reply.send({ ...initialTask, assignedAgentId: bestAgent.id });
            }
            else {
                reply.code(500).send({ error: `Agent ${bestAgent.id} accepted the task request but did not return valid initial task info.` });
            }
        }
        catch (error) {
            console.error(`Error creating/dispatching task:`, error);
            reply.code(500).send({ error: `Internal server error during task creation/dispatch: ${error.message}` });
        }
    });
    // Endpoint to list tasks for a specific agent
    fastify.get('/api/agents/:agentId/tasks', async (request, reply) => {
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
        const a2aClient = new a2aClient_1.A2AClient(selectedAgent.url);
        try {
            const tasks = await a2aClient.listTasks();
            if (tasks !== null) {
                reply.send(tasks);
            }
            else {
                reply.code(500).send({ error: `Failed to list tasks from agent ${agentId}` });
            }
        }
        catch (error) {
            console.error(`Error proxying listTasks for agent ${agentId}:`, error);
            reply.code(500).send({ error: { code: -32603, message: `Internal server error during listTasks proxy for agent ${agentId}`, data: error.message } });
        }
    });
}
