import { createServer } from './server';
import { AgentManager } from './services/agentManager';
// Removed Orchestrator import
import { registerProxyRoutes } from './routes/proxy';
import { registerTasksRoutes } from './routes/tasks';
import { setupApolloServer } from './graphql/server';

const start = async () => {
  // Removed orchestrator instantiation
  // Updated AgentManager instantiation (no args)
  const agentManager = new AgentManager();

  const fastify = createServer();

  registerProxyRoutes(fastify, agentManager);
  registerTasksRoutes(fastify, agentManager);

  // Updated setupApolloServer call (removed orchestrator)
  await setupApolloServer(fastify, agentManager);

  try {
    await fastify.listen({ port: 3000 });
    console.log('Backend server listening on http://localhost:3000/graphql');
    console.log('Serving frontend from http://localhost:3000/');
  } catch (err: any) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
