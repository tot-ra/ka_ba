import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import { ApolloServer } from '@apollo/server';
import fastifyApollo, { fastifyApolloDrainPlugin } from '@as-integrations/fastify';
import fastifyStatic from '@fastify/static';
import { buildSchema } from 'graphql';
import { readFileSync } from 'fs';
import { join } from 'path';
import { spawn, ChildProcess } from 'child_process'; // Import ChildProcess type
import axios, { AxiosResponse } from 'axios'; // Import AxiosResponse
import { Readable } from 'stream'; // Import Readable
import net from 'net'; // Import net module for port checking
import { A2AClient } from './a2aClient'; // Import A2AClient

// Define context interface
interface Context {
  request: FastifyRequest;
  reply: FastifyReply;
}

const fastify = Fastify({
  logger: true,
});

// Register CORS
fastify.register(cors, {
  origin: '*' // Allow all origins for now, can be configured later
});

// Serve static frontend files
fastify.register(fastifyStatic, {
  root: join(__dirname, '../../dist'), // Serving frontend build output from ba/dist
  prefix: '/', // Serve at the root
});

// Add a route for proxying streaming task requests
fastify.post('/api/tasks/sendSubscribe', async (request, reply) => {
  const { agentId, params } = request.body as { agentId: string; params: any }; // Assuming agentId and params are sent from frontend

  if (!agentId || !params) {
    reply.code(400).send({ error: 'Missing agentId or params' });
    return;
  }

  const selectedAgent = agents.find(agent => agent.id === agentId);

  if (!selectedAgent) {
    reply.code(404).send({ error: `Agent with ID ${agentId} not found` });
    return;
  }

  const a2aClient = new A2AClient(selectedAgent.url);

  try {
    const response = await a2aClient.sendTaskSubscribe(params);

    // Check if the response is a JSONRPC error response
    if ('error' in response) {
       // Handle JSONRPC error response from the agent
       reply.code(500).send({ error: response.error });
       return;
    }

    // If not an error, it must be an AxiosResponse with a Readable stream
    const streamResponse = response as AxiosResponse<Readable>; // Explicitly cast to AxiosResponse<Readable>

    // Set appropriate headers for SSE
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });

    // Pipe the stream from the agent to the client
    streamResponse.data.pipe(reply.raw);

    // Handle stream close and errors
    streamResponse.data.on('close', () => {
      console.log('SSE stream from agent closed');
      reply.raw.end();
    });

    streamResponse.data.on('error', (err: any) => { // Explicitly type err as any
      console.error('Error in SSE stream from agent:', err);
      // Attempt to send an error event before closing
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ code: -32603, message: 'Error streaming from agent', data: err.message })}\n\n`);
      reply.raw.end();
    });

  } catch (error: any) {
    console.error('Error proxying sendTaskSubscribe:', error);
    reply.code(500).send({ error: { code: -32603, message: 'Internal server error during streaming proxy', data: error.message } });
  }
});

// Add a route for proxying input task requests
fastify.post('/api/tasks/input', async (request, reply) => {
  const { agentId, params } = request.body as { agentId: string; params: any }; // Assuming agentId and params are sent from frontend

  if (!agentId || !params) {
    reply.code(400).send({ error: 'Missing agentId or params' });
    return;
  }

  const selectedAgent = agents.find(agent => agent.id === agentId);

  if (!selectedAgent) {
    reply.code(404).send({ error: `Agent with ID ${agentId} not found` });
    return;
  }

  const a2aClient = new A2AClient(selectedAgent.url);

  try {
    const task = await a2aClient.inputTask(params);
    if (task) {
      reply.send(task);
    } else {
      reply.code(500).send({ error: 'Failed to send input to agent' });
    }
  } catch (error: any) {
    console.error('Error proxying inputTask:', error);
    reply.code(500).send({ error: { code: -32603, message: 'Internal server error during input proxy', data: error.message } });
  }
});

// Add a route for proxying task status requests
fastify.post('/api/tasks/status', async (request, reply) => {
  const { agentId, params } = request.body as { agentId: string; params: any }; // Assuming agentId and params are sent from frontend

  if (!agentId || !params) {
    reply.code(400).send({ error: 'Missing agentId or params' });
    return;
  }

  const selectedAgent = agents.find(agent => agent.id === agentId);

  if (!selectedAgent) {
    reply.code(404).send({ error: `Agent with ID ${agentId} not found` });
    return;
  }

  const a2aClient = new A2AClient(selectedAgent.url);

  try {
    const task = await a2aClient.getTaskStatus(params);
    if (task) {
      reply.send(task);
    } else {
      reply.code(500).send({ error: 'Failed to get task status from agent' });
    }
  } catch (error: any) {
    console.error('Error proxying getTaskStatus:', error);
    reply.code(500).send({ error: { code: -32603, message: 'Internal server error during status proxy', data: error.message } });
  }
});

// Add a route for proxying task artifact requests
fastify.post('/api/tasks/artifact', async (request, reply) => {
  const { agentId, params } = request.body as { agentId: string; params: any }; // Assuming agentId and params are sent from frontend

  if (!agentId || !params) {
    reply.code(400).send({ error: 'Missing agentId or params' });
    return;
  }

  const selectedAgent = agents.find(agent => agent.id === agentId);

  if (!selectedAgent) {
    reply.code(404).send({ error: `Agent with ID ${agentId} not found` });
    return;
  }

  const a2aClient = new A2AClient(selectedAgent.url);

  try {
    // Assuming getTaskArtifact returns the artifact data directly or a response containing it
    const artifact = await a2aClient.getTaskArtifact(params);
    if (artifact) {
      reply.send(artifact);
    } else {
      reply.code(500).send({ error: 'Failed to get task artifact from agent' });
    }
  } catch (error: any) {
    console.error('Error proxying getTaskArtifact:', error);
    reply.code(500).send({ error: { code: -32603, message: 'Internal server error during artifact proxy', data: error.message } });
  }
});


// In-memory data store for agents
interface Agent {
  id: string;
  url: string;
  name?: string;
  description?: string;
  isLocal: boolean;
}

const agents: Agent[] = [];
let agentIdCounter = 1;

// Function to notify other agents about changes in the agent list
const notifyAgents = async (currentAgents: Agent[]) => {
  const agentUrls = currentAgents.map(agent => agent.url);
  console.log('Notifying agents about updated list:', agentUrls);
  for (const agent of currentAgents) {
    try {
      // Avoid notifying the agent about itself, although in this case,
      // we are sending the full list to everyone.
      // If we wanted to exclude the agent being added/removed, we'd filter here.
      // For now, send the full list to all.
      await axios.post(`${agent.url}/agents/update`, { agentUrls });
      console.log(`Successfully notified agent at ${agent.url}`);
    } catch (error: any) {
      console.error(`Failed to notify agent at ${agent.url}:`, error.message);
    }
  }
};


// Data structure to track spawned ka processes
interface SpawnedProcessInfo {
  process: ChildProcess; // Use imported ChildProcess type
  pid: number;
  port: number; // Added port
  config: {
    model?: string;
    systemPrompt?: string;
    apiBaseUrl?: string;
  };
}

const spawnedProcesses: Map<string, SpawnedProcessInfo> = new Map();

// --- Helper function to find an available port ---
const checkPort = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false); // Port is definitely in use
      } else {
        // Other errors might indicate issues but not necessarily that the port is used
        console.warn(`Error checking port ${port}: ${err.message}`);
        resolve(true); // Assume available on other errors, might need refinement
      }
    });
    server.once('listening', () => {
      server.close(() => {
        resolve(true); // Port was available
      });
    });
    server.listen(port, '127.0.0.1'); // Listen on localhost only
  });
};

const findAvailablePort = async (startPort = 10000, endPort = 65535, maxAttempts = 100): Promise<number> => {
  for (let i = 0; i < maxAttempts; i++) {
    const port = Math.floor(Math.random() * (endPort - startPort + 1)) + startPort;
    const isAvailable = await checkPort(port);
    if (isAvailable) {
      console.log(`Found available port: ${port}`);
      return port;
    }
    console.log(`Port ${port} is in use, trying another...`);
  }
  throw new Error(`Could not find an available port after ${maxAttempts} attempts.`);
};
// --- End helper function ---

// Load GraphQL schema
const schemaString = readFileSync(join(__dirname, '../../backend/src/schema.graphql'), 'utf8');
const schema = buildSchema(schemaString);

// Define resolvers
const resolvers = {
  Query: {
    agents: (_parent: any, _args: any, _context: Context, _info: any) => agents, // Added standard resolver args
  },
  Mutation: {
    // Corrected signature: added parent, args, context, info
    addAgent: (_parent: any, { url, name }: { url: string, name?: string }, _context: Context, _info: any) => {
      // In a real app, you would fetch the agent card here to get name/description
      const newAgent: Agent = {
        id: (agentIdCounter++).toString(),
        url,
        name: name || `Agent ${agentIdCounter - 1}`, // Use provided name or placeholder
        description: `Agent at ${url}`, // Placeholder description
        isLocal: false, // Remote agents are not local
      };
      agents.push(newAgent);
      console.log(`Added agent: ${newAgent.url}`);
      notifyAgents(agents); // Notify agents after adding
      return newAgent;
    },
    // Corrected signature: added parent, args, context, info
    removeAgent: (_parent: any, { id }: { id: string }, _context: Context, _info: any) => {
      const initialLength = agents.length;
      const index = agents.findIndex(agent => agent.id === id);
      if (index > -1) {
        const removedAgent = agents.splice(index, 1)[0];
        console.log(`Removed agent: ${removedAgent.url}`);

        notifyAgents(agents); // Notify agents after removing

        // Check if the removed agent was a locally spawned ka process
        const spawnedProcessInfo = spawnedProcesses.get(removedAgent.id);
        if (spawnedProcessInfo) {
          // Ensure pid is a valid number before attempting to kill
          if (typeof spawnedProcessInfo.pid === 'number') {
            console.log(`Stopping associated spawned ka process with PID: ${spawnedProcessInfo.pid}`);
            try {
              process.kill(spawnedProcessInfo.pid);
              spawnedProcesses.delete(removedAgent.id); // Delete by agent ID
              console.log(`Stopped and removed spawned process info for agent ID: ${removedAgent.id}`);
            } catch (err: any) { // Explicitly type err as any
              console.error(`Failed to stop process with PID ${spawnedProcessInfo.pid} during agent removal: ${err}`);
              // Decide if agent removal should fail if process kill fails. Currently continues.
            }
          } else {
            console.error(`Invalid or missing PID for agent ID: ${removedAgent.id} during removal. Cleaning up map entry.`);
            spawnedProcesses.delete(removedAgent.id); // Clean up map entry even if PID was bad
          }
        }

        // TODO: Implement logic to notify other agents about the removed agent (if needed beyond notifyAgents)
        return true;
      }
      return false; // Agent not found
    },
    // Corrected signature: added parent, args, context, info
    spawnKaAgent: async (_parent: any, args: { model?: string, systemPrompt?: string, apiBaseUrl?: string, port?: number | null, name?: string, description?: string }, _context: Context, _info: any): Promise<Agent | null> => {
      const { model, systemPrompt, apiBaseUrl, port: requestedPort, name, description } = args;
      console.log('Attempting to spawn ka agent with:', { model, systemPrompt, apiBaseUrl, port: requestedPort, name, description });

      // Define environment variables for the ka process
      const env: NodeJS.ProcessEnv = { ...process.env }; // Explicitly type env
      if (model) env.LLM_MODEL = model;
      if (systemPrompt) env.LLM_SYSTEM_MESSAGE = systemPrompt;
      if (apiBaseUrl) env.LLM_API_BASE = apiBaseUrl;


      // Calculate absolute path to the ka executable relative to this script's location
      const kaExecutablePath = join(__dirname, '..', '..', '..', 'ka', 'ka');
      console.log(`Calculated absolute path for ka executable: ${kaExecutablePath}`);

      let agentPort: number;
      try {
        if (requestedPort && requestedPort > 0) {
          console.log(`Requested specific port: ${requestedPort}`);
          const isAvailable = await checkPort(requestedPort);
          if (isAvailable) {
            agentPort = requestedPort;
            console.log(`Using requested port ${agentPort}`);
          } else {
            console.error(`Requested port ${requestedPort} is already in use.`);
            // TODO: Consider throwing a specific GraphQL error here
            throw new Error(`Port ${requestedPort} is already in use.`);
          }
        } else {
          console.log('No specific port requested or port is 0, finding random available port...');
          agentPort = await findAvailablePort(); // findAvailablePort already logs the found port
        }
      } catch (error: any) {
        console.error("Failed to determine port for ka agent:", error);
        // TODO: Consider throwing a specific GraphQL error here
        return null; // Return null if no port could be determined/found
      }

      // Set PORT environment variable *after* agentPort is assigned
      env.PORT = agentPort.toString();

      const agentUrl = `http://localhost:${agentPort}`; // Use the determined port
      console.log(`Attempting to spawn ka agent at ${agentUrl} using PORT=${agentPort}`);

      // Prepare command-line arguments for ka (flags first, then command)
      const kaArgs = [];
      if (name) {
        kaArgs.push('--name', name);
      }
      if (description) {
        kaArgs.push('--description', description);
      }
      if (model) {
        kaArgs.push('--model', model);
      }
      kaArgs.push('server'); // Add the command last
      console.log('Spawning ka with args:', kaArgs);

      // Spawn ka agent using absolute path, port is set via environment variable
      // Removed cwd as we are using an absolute path for the executable
      const kaProcess = spawn(kaExecutablePath, kaArgs, {
        env,
        detached: true, // Allows the child process to run independently of the parent
        stdio: ['ignore', 'pipe', 'pipe'] // Pipe stdout and stderr
      });

      kaProcess.unref(); // Allow the parent to exit independently

      try {
          const newAgent = await new Promise<Agent>((resolve, reject) => {
            let resolved = false; // Flag to prevent multiple resolves/rejects
            let processError: Error | null = null;

        const handleStartupError = (errorMsg: string, err?: Error) => {
          if (resolved) return;
          resolved = true;
          console.error(`ka agent startup failed: ${errorMsg}`, err || '');
          // Ensure the process is terminated if it somehow still exists
          if (kaProcess && !kaProcess.killed) {
            kaProcess.kill();
          }
          reject(new Error(`Failed to spawn agent: ${errorMsg}`)); // Reject the promise
        };

        kaProcess.stdout.on('data', (data: Buffer) => {
          const output = data.toString();
          console.log(`[ka stdout ${agentPort}]: ${output}`); // Add port to log
          // Check for the specific port in the startup message
          if (output.includes(`Agent server running at http://localhost:${agentPort}/`) && !resolved) {
            resolved = true;
            console.log(`ka agent on port ${agentPort} seems to have started successfully.`);

            // Now that we think it started, create and add the agent
            const newAgent: Agent = {
              id: (agentIdCounter++).toString(),
              url: agentUrl,
              name: name || `Spawned ka Agent ${agentIdCounter - 1}`,
              description: description || `ka agent spawned with model: ${model || 'default'}`, // Use provided description or fallback
              isLocal: true,
            };
            agents.push(newAgent);
            console.log(`Added spawned agent: ${newAgent.url}`);
            notifyAgents(agents);

            if (typeof kaProcess.pid === 'number') {
              spawnedProcesses.set(newAgent.id, {
                process: kaProcess,
                pid: kaProcess.pid,
                port: agentPort, // Store the port
                config: { model, systemPrompt, apiBaseUrl },
              });
              console.log(`Stored spawned process info for agent ID: ${newAgent.id} with PID: ${kaProcess.pid} on port ${agentPort}`);
              resolve(newAgent); // Resolve the promise with the new agent
            } else {
              // This case should be rare if the process started, but handle it.
              handleStartupError('Process started but PID is missing.');
            }
          }
        });

        kaProcess.stderr.on('data', (data: Buffer) => {
          const output = data.toString();
          console.error(`[ka stderr ${agentPort}]: ${output}`); // Add port to log
          // Check for the specific port in the error message
          if (output.includes('address already in use') && output.includes(`:${agentPort}`)) {
            handleStartupError(`Port ${agentPort} already in use.`);
          }
          // Store the last error message in case the process exits without specific stdout
          processError = new Error(output.trim());
        });

        kaProcess.on('error', (err: Error) => {
          handleStartupError(`Process spawn error: ${err.message}`, err);
        });

        kaProcess.on('exit', (code: number | null, signal: string | null) => {
          console.log(`ka process exited with code ${code} and signal ${signal}`);
          // If it exits quickly before resolving, it's likely an error
          if (!resolved) {
            const exitMsg = `Process exited prematurely with code ${code}, signal ${signal}.`;
            handleStartupError(exitMsg, processError || undefined); // Use stored stderr if available, ensuring undefined if null
          } else {
            // Process exited after successful start, handle cleanup if needed
            console.log(`Spawned agent process (ID: ${/* Need agent ID here */''}) exited after successful start.`);
            // Find agent ID associated with this PID if possible, or handle generally
            let agentIdToRemove: string | null = null;
            for (const [id, info] of spawnedProcesses.entries()) {
              if (info.process === kaProcess || info.pid === kaProcess.pid) {
                agentIdToRemove = id;
                break;
              }
            }
            if (agentIdToRemove) {
              console.log(`Cleaning up agent ID: ${agentIdToRemove} due to process exit.`);
              spawnedProcesses.delete(agentIdToRemove);
              const agentIndex = agents.findIndex(agent => agent.id === agentIdToRemove);
              if (agentIndex > -1) {
                agents.splice(agentIndex, 1);
                notifyAgents(agents); // Notify others about the removal
              }
            }
          }
        });

        // Add a timeout in case the agent never outputs the success message
        const startupTimeout = setTimeout(() => {
          if (!resolved) {
            handleStartupError('Startup timeout. Agent did not confirm successful start.');
          }
        }, 10000); // 10 seconds timeout

        // Ensure timeout is cleared if resolved/rejected
            kaProcess.on('close', () => clearTimeout(startupTimeout));
            kaProcess.on('error', () => clearTimeout(startupTimeout));

          }); // End of Promise definition

          return newAgent; // Return the resolved agent if promise succeeds

      } catch (error: unknown) { // Catch errors from the awaited promise
          console.error("Error during spawnKaAgent execution:", error);
          if (error instanceof Error) {
              console.error("Spawn Error message:", error.message);
          }
          // Ensure the process is killed if it exists and the promise failed
          if (kaProcess && !kaProcess.killed) {
              console.log("Ensuring failed kaProcess is killed.");
              kaProcess.kill();
          }
          return null; // Return null from the mutation on failure
      }
    },
    // Corrected signature: added parent, args, context, info
    stopKaAgent: (_parent: any, { id }: { id: string }, _context: Context, _info: any) => {
      console.log(`Attempting to stop ka agent with ID: ${id}`);
      const spawnedProcessInfo = spawnedProcesses.get(id);

      if (!spawnedProcessInfo) {
        console.log(`No spawned process found for agent ID: ${id}`);
        return false; // Process not found
      }

      // Ensure pid is a valid number before attempting to kill
      if (typeof spawnedProcessInfo.pid !== 'number') {
        console.error(`Invalid or missing PID for agent ID: ${id}. Cannot stop process.`);
        // Clean up potentially orphaned entries if PID is bad
        spawnedProcesses.delete(id);
        const agentIndex = agents.findIndex(agent => agent.id === id);
        if (agentIndex > -1) {
          agents.splice(agentIndex, 1);
        }
        return false;
      }

      try {
        // Attempt to kill the process using the validated PID
        process.kill(spawnedProcessInfo.pid);
        console.log(`Sent kill signal to process with PID: ${spawnedProcessInfo.pid}`);

        // Remove from tracking and agents list
        spawnedProcesses.delete(id);
        const agentIndex = agents.findIndex(agent => agent.id === id);
        if (agentIndex > -1) {
          agents.splice(agentIndex, 1);
          console.log(`Removed agent with ID: ${id} from agents list`);
        }

        return true;
      } catch (err: any) { // Explicitly type err as any
        console.error(`Failed to stop process with PID ${spawnedProcessInfo.pid}: ${err}`);
        // If the error is ESRCH, the process is already gone.
        // We should still clean up the agent list and the map.
        if (err.code === 'ESRCH') {
            console.log(`Process with PID ${spawnedProcessInfo.pid} not found (ESRCH). Assuming already stopped.`);
            spawnedProcesses.delete(id);
            const agentIndex = agents.findIndex(agent => agent.id === id);
            if (agentIndex > -1) {
              agents.splice(agentIndex, 1);
              console.log(`Removed agent with ID: ${id} from agents list as process was not found.`);
            }
            return true; // Consider it a success in terms of cleanup
        }
        return false; // Failed to stop process for other reasons
      }
    },
  },
};

// Create Apollo Server
const apollo = new ApolloServer<Context>({
  typeDefs: schemaString,
  resolvers,
  plugins: [fastifyApolloDrainPlugin(fastify)]
});

// Start Apollo Server and register with Fastify
const start = async () => {
  try {
    await apollo.start();
    
    // Register Apollo Fastify plugin
    await fastify.register(fastifyApollo(apollo), {
      path: '/graphql',
      context: async (request, reply) => {
        return {
          request,
          reply
        };
      }
    });
    
    await fastify.listen({ port: 3000 }); // Listen on port 3000
    console.log('Backend server listening on http://localhost:3000/graphql');
    console.log('Serving frontend from http://localhost:3000/');
  } catch (err: any) { // Explicitly type err as any
    fastify.log.error(err);
    process.exit(1);
  }
};

// Call the start function
start();
