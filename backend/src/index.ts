import { createServer } from './server.js'; // Add .js extension
import { AgentManager } from './services/agentManager.js'; // Add .js extension
import { PubSub } from 'graphql-subscriptions'; // Import PubSub
import { registerProxyRoutes } from './routes/proxy.js'; // Add .js extension
import { setupApolloServer } from './graphql/server.js'; // Add .js extension

const start = async () => {
  // Create a single PubSub instance
  const pubsub = new PubSub(); // Note: We might need to type this later if issues persist

  // Instantiate AgentManager, passing the pubsub instance
  const agentManager = new AgentManager(pubsub);

  const fastify = createServer();

  registerProxyRoutes(fastify, agentManager);

  // Pass the pubsub instance to setupApolloServer
  await setupApolloServer(fastify, agentManager, pubsub);

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
