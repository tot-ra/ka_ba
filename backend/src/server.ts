import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
