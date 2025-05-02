import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { ApolloServer } from '@apollo/server';
import fastifyApollo, { fastifyApolloDrainPlugin } from '@as-integrations/fastify';
import { schemaString } from './schema';
import { createResolvers } from './resolvers';
import { AgentManager } from '../services/agentManager';
// Removed Orchestrator import

interface ApolloContext {
  request: FastifyRequest;
  reply: FastifyReply;
  agentManager: AgentManager;
  // Removed orchestrator from context
}

// Removed orchestrator from function signature
export async function setupApolloServer(
  fastify: FastifyInstance,
  agentManager: AgentManager
) {
  // Updated call to createResolvers
  const resolvers = createResolvers(agentManager);

  const apollo = new ApolloServer<ApolloContext>({
    typeDefs: schemaString,
    resolvers,
    plugins: [fastifyApolloDrainPlugin(fastify)]
  });

  await apollo.start();

  await fastify.register(fastifyApollo(apollo), {
    path: '/graphql',
    context: async (request, reply) => {
      return {
        request,
        reply,
        agentManager
        // Removed orchestrator from returned context
      };
    }
  });

  console.log('Apollo Server registered at /graphql');
}
