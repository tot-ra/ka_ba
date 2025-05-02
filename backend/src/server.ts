import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { join } from 'path';

export function createServer() {
  const fastify = Fastify({
    logger: true,
  });

  fastify.register(cors, {
    origin: '*'
  });

  fastify.register(fastifyStatic, {
    root: join(__dirname, '../../dist'),
    prefix: '/',
  });

  return fastify;
}
