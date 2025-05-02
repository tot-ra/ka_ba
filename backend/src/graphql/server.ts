import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ApolloServer } from '@apollo/server';
import fastifyApollo, { fastifyApolloDrainPlugin } from '@as-integrations/fastify';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer'; // Import drain plugin
import { makeExecutableSchema } from '@graphql-tools/schema';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/use/ws';
import { Context as WsContext, SubscribeMessage } from 'graphql-ws';
import { EventEmitter } from 'node:events'; // Import EventEmitter

import { schemaString } from './schema.js';
import { createResolvers, LogEntryPayload } from './resolvers.js';
import { AgentManager } from '../services/agentManager.js'; // Add .js extension

// Define the payload type for the PubSub (still useful for context typing)
// This should match the structure published by agentManager and expected by the subscription resolver
interface PubSubPayloads {
  [topic: string]: LogEntryPayload; // Use LogEntryPayload from resolvers
} // <-- Added missing closing brace


export interface ApolloContext {
  request?: FastifyRequest;
  reply?: FastifyReply;
  agentManager: AgentManager;
  eventEmitter: EventEmitter; // Change pubsub to eventEmitter
}

// Update function signature to accept eventEmitter instance
export async function setupApolloServer(
  fastify: FastifyInstance,
  agentManager: AgentManager,
  eventEmitter: EventEmitter // Accept eventEmitter instance
) {
  // Create resolvers, passing the received eventEmitter instance
  const resolvers = createResolvers(agentManager, eventEmitter);

  // Create executable schema
  const schema = makeExecutableSchema({ typeDefs: schemaString, resolvers });

  // Create WebSocket server using Fastify's underlying HTTP server
  const wsServer = new WebSocketServer({
    server: fastify.server,
    path: '/graphql',
  });

  // Create drain plugin for the HTTP server
  const drainHttpServerPlugin = ApolloServerPluginDrainHttpServer({ httpServer: fastify.server });

  // Setup graphql-ws server using useServer
  const serverCleanup = useServer( // Revert to useServer
    {
      schema,
      // Provide context for WebSocket operations (subscriptions)
      context: async (ctx: WsContext, msg: SubscribeMessage /* args removed */): Promise<Omit<ApolloContext, 'request' | 'reply'>> => { // Context for subscriptions
        console.log('[GraphQL Server] Creating subscription context with EventEmitter.'); // Updated log
        // You can add authentication/authorization logic here based on ctx.connectionParams
        return { agentManager, eventEmitter }; // Return context needed for subscriptions
      },
      onConnect: (ctx: WsContext) => {
        console.log('WebSocket client connected', ctx.connectionParams);
        return true; // Accept connection
      },
      onDisconnect: (ctx: WsContext, code?: number, reason?: string) => { // Allow code and reason to be undefined
        console.log(`WebSocket client disconnected (${code ?? 'N/A'}): ${reason ?? 'N/A'}`, ctx.connectionParams); // Handle potential undefined values
      },
    },
    wsServer // Pass the ws server instance
  );

   // Create Apollo Server instance with the schema and plugins
   const apollo = new ApolloServer<Omit<ApolloContext, 'request' | 'reply'>>({
    schema,
    plugins: [
      // Use the HTTP server drain plugin
      drainHttpServerPlugin,
      // Custom plugin to drain the GraphQL WebSocket server using the cleanup function from useServer
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
              console.log('GraphQL WebSocket Server disposed.');
            },
          };
        },
      },
    ],
  });

  // Start Apollo Server
  await apollo.start();


  // Register Apollo Server HTTP integration with Fastify
  await fastify.register(fastifyApollo(apollo), {
    path: '/graphql',
    // Provide context for HTTP operations (queries/mutations)
    context: async (request, reply): Promise<ApolloContext> => {
      return {
        request,
        reply,
        agentManager,
        eventEmitter, // Add eventEmitter here too
      };
    },
  });

  console.log('Apollo Server registered at /graphql (HTTP)');
  console.log('WebSocket subscriptions ready at ws://localhost:3000/graphql'); // Assuming default port 3000
}
