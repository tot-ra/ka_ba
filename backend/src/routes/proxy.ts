import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Readable } from 'stream';
import { AxiosResponse } from 'axios';
import { AgentManager } from '../services/agentManager';
import { A2AClient } from '../a2aClient';

interface TaskRequestBody {
  agentId: string;
  params: any;
}

export function registerProxyRoutes(fastify: FastifyInstance, agentManager: AgentManager) {

  const getAgentAndClient = (agentId: string, reply: FastifyReply): { agent: any, client: A2AClient } | null => {
    if (!agentId) {
      reply.code(400).send({ error: 'Missing agentId' });
      return null;
    }
    const agent = agentManager.getAgents().find(a => a.id === agentId);
    if (!agent) {
      reply.code(404).send({ error: `Agent with ID ${agentId} not found` });
      return null;
    }
    return { agent, client: new A2AClient(agent.url) };
  };

  fastify.post('/api/tasks/sendSubscribe', async (request: FastifyRequest<{ Body: TaskRequestBody }>, reply: FastifyReply) => {
    const { agentId, params } = request.body;
    const agentInfo = getAgentAndClient(agentId, reply);
    if (!agentInfo) return;

    const { client } = agentInfo;

    try {
      const response = await client.sendTaskSubscribe(params);

      if ('error' in response) {
         reply.code(500).send({ error: response.error });
         return;
      }

      const streamResponse = response as AxiosResponse<Readable>;

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      streamResponse.data.pipe(reply.raw);

      streamResponse.data.on('close', () => {
        console.log(`SSE stream from agent ${agentId} closed`);
        if (!reply.raw.writableEnded) {
            reply.raw.end();
        }
      });

      streamResponse.data.on('error', (err: any) => {
        console.error(`Error in SSE stream from agent ${agentId}:`, err);
        if (!reply.raw.writableEnded) {
            reply.raw.write(`event: error\ndata: ${JSON.stringify({ code: -32603, message: 'Error streaming from agent', data: err.message })}\n\n`);
            reply.raw.end();
        }
      });

      request.raw.on('close', () => {
          console.log(`Client disconnected from SSE stream for agent ${agentId}`);
          if (streamResponse.data && typeof streamResponse.data.destroy === 'function') {
              streamResponse.data.destroy();
          }
          if (!reply.raw.writableEnded) {
              reply.raw.end();
          }
      });


    } catch (error: any) {
      console.error(`Error proxying sendTaskSubscribe for agent ${agentId}:`, error);
      if (!reply.sent) {
        reply.code(500).send({ error: { code: -32603, message: 'Internal server error during streaming proxy', data: error.message } });
      }
    }
  });

  fastify.post('/api/tasks/input', async (request: FastifyRequest<{ Body: TaskRequestBody }>, reply: FastifyReply) => {
    const { agentId, params } = request.body;
    const agentInfo = getAgentAndClient(agentId, reply);
    if (!agentInfo) return;

    const { client } = agentInfo;

    try {
      const task = await client.inputTask(params);
      if (task) {
        reply.send(task);
      } else {
        reply.code(500).send({ error: `Failed to send input to agent ${agentId}` });
      }
    } catch (error: any) {
      console.error(`Error proxying inputTask for agent ${agentId}:`, error);
      reply.code(500).send({ error: { code: -32603, message: 'Internal server error during input proxy', data: error.message } });
    }
  });

  fastify.post('/api/tasks/status', async (request: FastifyRequest<{ Body: TaskRequestBody }>, reply: FastifyReply) => {
    const { agentId, params } = request.body;
    const agentInfo = getAgentAndClient(agentId, reply);
    if (!agentInfo) return;

    const { client } = agentInfo;

    try {
      const task = await client.getTaskStatus(params);
      if (task) {
        reply.send(task);
      } else {
        reply.code(500).send({ error: `Failed to get task status from agent ${agentId}` });
      }
    } catch (error: any) {
      console.error(`Error proxying getTaskStatus for agent ${agentId}:`, error);
      reply.code(500).send({ error: { code: -32603, message: 'Internal server error during status proxy', data: error.message } });
    }
  });

  fastify.post('/api/tasks/artifact', async (request: FastifyRequest<{ Body: TaskRequestBody }>, reply: FastifyReply) => {
    const { agentId, params } = request.body;
    const agentInfo = getAgentAndClient(agentId, reply);
    if (!agentInfo) return;

    const { client } = agentInfo;

    try {
      const artifact = await client.getTaskArtifact(params);
      if (artifact) {
        reply.send(artifact);
      } else {
        reply.code(500).send({ error: `Failed to get task artifact from agent ${agentId}` });
      }
    } catch (error: any) {
      console.error(`Error proxying getTaskArtifact for agent ${agentId}:`, error);
      reply.code(500).send({ error: { code: -32603, message: 'Internal server error during artifact proxy', data: error.message } });
    }
  });
}
