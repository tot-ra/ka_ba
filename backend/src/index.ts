import { createServer } from './server.js';
import { AgentManager } from './services/agentManager.js';
import { EventEmitter } from 'node:events'; // Import EventEmitter
import { registerProxyRoutes } from './routes/proxy.js';
import { setupApolloServer } from './graphql/server.js';
// Removed PubSub import

const start = async () => {
  // Create a single EventEmitter instance
  const eventEmitter = new EventEmitter();
  // Optional: Increase max listeners if many subscriptions are expected
  // eventEmitter.setMaxListeners(50);
  console.log('[Index] Created EventEmitter instance.');

  // Instantiate AgentManager, passing the eventEmitter instance
  const agentManager = new AgentManager(eventEmitter);

  const fastify = createServer();

  registerProxyRoutes(fastify, agentManager);

  // Pass the eventEmitter instance to setupApolloServer
  await setupApolloServer(fastify, agentManager, eventEmitter);

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
