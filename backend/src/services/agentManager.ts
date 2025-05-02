import { spawn, ChildProcess } from 'child_process';
import { join, dirname } from 'path'; // Import dirname
import { fileURLToPath } from 'url'; // Import fileURLToPath
import net from 'net';
import axios from 'axios';
import { PubSub } from 'graphql-subscriptions'; // Import PubSub
import { LogEntryPayload } from '../graphql/resolvers.js'; // Add .js extension

// Get current directory using import.meta.url for ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface Agent {
  id: string;
  url: string;
  name?: string;
  description?: string; // This might become redundant if capabilities.description is used
  isLocal: boolean;
  capabilities?: AgentCapabilities | null; // Added field for agent.json content
}

// Interface for the expected structure of /.well-known/agent.json
interface AgentCapabilities {
  name: string;
  description: string;
  url: string; // Agent's base URL
  api_version: string;
  protocol_version: string;
  endpoints: {
    tasks_send: string;
    tasks_send_subscribe: string;
    tasks_status: string;
    tasks_artifact?: string; // Optional
    // Add other standard endpoints as needed
  };
  authentication: string[]; // e.g., ["none", "jwt"]
  // Add other potential fields like input_schema, output_schema, tags etc.
}


interface SpawnedProcessInfo {
  process: ChildProcess;
  pid: number;
  port: number;
  logs: string[]; // Added to store logs
  config: {
    model?: string;
    systemPrompt?: string;
    apiBaseUrl?: string;
  };
}

export class AgentManager {
  private agents: Agent[] = [];
  private spawnedProcesses: Map<string, SpawnedProcessInfo> = new Map();
  private agentIdCounter = 1;
  private pubsub: PubSub; // Add pubsub property

  // Inject PubSub via constructor
  constructor(pubsub: PubSub) {
    this.pubsub = pubsub;
  }

  // Modify Agent type returned by getAgents to potentially include pid
  public getAgents(): (Agent & { pid?: number })[] {
    return this.agents.map(agent => {
      if (agent.isLocal) {
        const processInfo = this.spawnedProcesses.get(agent.id);
        return {
          ...agent,
          pid: processInfo?.pid, // Add pid if process info exists
        };
      }
      return agent; // Return unmodified for remote agents
    });
  }


  public addRemoteAgent(url: string, name?: string): Agent {
    const newAgent: Agent = {
      id: (this.agentIdCounter++).toString(),
      url,
      name: name || `Agent ${this.agentIdCounter - 1}`,
      description: `Agent at ${url}`,
      isLocal: false,
    };
    this.agents.push(newAgent);
    console.log(`Added remote agent: ${newAgent.url}`);
    this.fetchAgentCapabilities(newAgent); // Fetch capabilities after adding
    this.notifyAgents();
    return newAgent;
  }

  public removeAgent(id: string): boolean {
    const index = this.agents.findIndex(agent => agent.id === id);
    if (index > -1) {
      const removedAgent = this.agents.splice(index, 1)[0];
      console.log(`Removed agent: ${removedAgent.url}`);
      this.notifyAgents();

      const spawnedProcessInfo = this.spawnedProcesses.get(removedAgent.id);
      if (spawnedProcessInfo) {
        this.stopLocalAgentProcess(removedAgent.id, spawnedProcessInfo);
      }
      return true;
    }
    return false;
  }

  public async spawnLocalAgent(args: { model?: string, systemPrompt?: string, apiBaseUrl?: string, port?: number | null, name?: string, description?: string }): Promise<Agent | null> {
    const { model, systemPrompt, apiBaseUrl, port: requestedPort, name, description } = args;
    console.log('Attempting to spawn ka agent with:', { model, systemPrompt, apiBaseUrl, port: requestedPort, name, description });

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (model) env.LLM_MODEL = model;
    if (systemPrompt) env.LLM_SYSTEM_MESSAGE = systemPrompt;
    if (apiBaseUrl) env.LLM_API_BASE = apiBaseUrl;

    // Use the calculated __dirname for ES Modules
    const kaExecutablePath = join(__dirname, '..', '..', '..', 'ka', 'ka');
    console.log(`Calculated absolute path for ka executable: ${kaExecutablePath}`);

    let agentPort: number;
    try {
      agentPort = await this.determinePort(requestedPort);
    } catch (error: any) {
      console.error("Failed to determine port for ka agent:", error);
      return null;
    }

    env.PORT = agentPort.toString();
    const agentUrl = `http://localhost:${agentPort}`;
    console.log(`Attempting to spawn ka agent at ${agentUrl} using PORT=${agentPort}`);

    const kaArgs = [];
    if (name) kaArgs.push('--name', name);
    if (description) kaArgs.push('--description', description);
    if (model) kaArgs.push('--model', model);
    kaArgs.push('server');
    console.log('Spawning ka with args:', kaArgs);

    const kaProcess = spawn(kaExecutablePath, kaArgs, {
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    kaProcess.unref();

    try {
      // Destructure the agent and initial logs from the result
      const { agent: newAgent, logs: initialLogs } = await this.waitForAgentStartup(kaProcess, agentPort, agentUrl, name, description, model, systemPrompt, apiBaseUrl);

      this.agents.push(newAgent);
      console.log(`Added spawned agent: ${newAgent.url}`);
      this.notifyAgents();

      if (typeof kaProcess.pid === 'number') {
        this.spawnedProcesses.set(newAgent.id, {
          process: kaProcess,
          pid: kaProcess.pid,
          port: agentPort,
          logs: initialLogs, // Store initial logs captured during startup
          config: { model, systemPrompt, apiBaseUrl },
        });
        console.log(`Stored spawned process info for agent ID: ${newAgent.id} with PID: ${kaProcess.pid} on port ${agentPort}`);

        // Now setup handlers to capture ongoing logs
        this.setupOngoingLogCapture(kaProcess, newAgent.id);

      } else {
         console.error(`Process started for agent ${newAgent.id} but PID is missing.`);
         kaProcess.kill();
         this.agents = this.agents.filter(a => a.id !== newAgent.id);
         this.notifyAgents();
         throw new Error('Process started but PID is missing.');
      }

      this.setupProcessExitHandler(kaProcess, newAgent.id); // Keep exit handler separate
      this.fetchAgentCapabilities(newAgent); // Fetch capabilities after startup
      return newAgent; // Return only the agent object as before

    } catch (error: unknown) {
      console.error("Error during spawnKaAgent execution:", error);
      if (kaProcess && !kaProcess.killed) {
        console.log("Ensuring failed kaProcess is killed.");
        kaProcess.kill();
      }
      return null;
    }
  }

  public stopLocalAgent(id: string): boolean {
    console.log(`Attempting to stop ka agent with ID: ${id}`);
    const spawnedProcessInfo = this.spawnedProcesses.get(id);

    if (!spawnedProcessInfo) {
      console.log(`No spawned process found for agent ID: ${id}`);
      const agentIndex = this.agents.findIndex(agent => agent.id === id && agent.isLocal);
      if (agentIndex > -1) {
          console.log(`Agent ${id} found in list but not in spawned processes. Removing from list.`);
          this.agents.splice(agentIndex, 1);
          this.notifyAgents();
          return true;
      }
      return false;
    }

    return this.stopLocalAgentProcess(id, spawnedProcessInfo);
  }

  private stopLocalAgentProcess(agentId: string, info: SpawnedProcessInfo): boolean {
     if (typeof info.pid !== 'number') {
        console.error(`Invalid or missing PID for agent ID: ${agentId}. Cannot stop process.`);
        this.cleanupAgentData(agentId);
        return false;
      }

      try {
        process.kill(info.pid);
        console.log(`Sent kill signal to process with PID: ${info.pid}`);
        this.cleanupAgentData(agentId);
        return true;
      } catch (err: any) {
        console.error(`Failed to stop process with PID ${info.pid}: ${err}`);
        if (err.code === 'ESRCH') {
            console.log(`Process with PID ${info.pid} not found (ESRCH). Assuming already stopped.`);
            this.cleanupAgentData(agentId);
            return true;
        }
        return false;
      }
  }

  private cleanupAgentData(agentId: string): void {
      this.spawnedProcesses.delete(agentId);
      const agentIndex = this.agents.findIndex(agent => agent.id === agentId);
      if (agentIndex > -1) {
        this.agents.splice(agentIndex, 1);
        console.log(`Removed agent with ID: ${agentId} from agents list`);
        this.notifyAgents();
      }
  }

  // --- Log Management ---

  private _addLog(agentId: string, message: string, stream: 'stdout' | 'stderr'): void {
    const processInfo = this.spawnedProcesses.get(agentId);
    if (processInfo) {
      const timestamp = new Date().toISOString();
      const line = message.trim();
      const maxLogLines = 100; // Consistent max log lines

      // Store historical log (optional, could be removed if only real-time is needed)
      const logEntryForStorage = `[${timestamp}] [${stream}] ${line}`;
      processInfo.logs.push(logEntryForStorage);
      if (processInfo.logs.length > maxLogLines) {
        processInfo.logs.shift(); // Remove the oldest log line
      }

      // Publish real-time log entry via PubSub
      const payload: LogEntryPayload = {
        timestamp,
        stream,
        line,
      };
      const topic = `AGENT_LOG_${agentId}`;
      // console.log(`Publishing to topic ${topic}:`, payload); // Debug log
      this.pubsub.publish(topic, { agentLogs: payload }); // Wrap payload according to subscription name

    } else {
      // Don't warn here as this might be called after cleanup during shutdown
      // console.warn(`Attempted to add log for non-existent or cleaned up agent process: ${agentId}`);
    }
  }


  private setupOngoingLogCapture(kaProcess: ChildProcess, agentId: string): void {
    const handleData = (data: Buffer, stream: 'stdout' | 'stderr') => {
      // Split potential multi-line output into individual lines
      const lines = data.toString().split('\n');
      lines.forEach((line, index) => {
        // Don't publish empty lines, except possibly the last partial line
        if (line || (index === lines.length - 1 && lines.length > 1)) {
           this._addLog(agentId, line, stream);
        }
      });
    };

    kaProcess.stdout?.on('data', (data: Buffer) => handleData(data, 'stdout'));
    kaProcess.stderr?.on('data', (data: Buffer) => handleData(data, 'stderr'));
  }


  public getAgentLogs(agentId: string): string[] | null {
    const processInfo = this.spawnedProcesses.get(agentId);
    return processInfo ? processInfo.logs : null;
  }

  // --- Agent Notification & Port Management ---

  private async notifyAgents() {
    // Removed orchestrator.updateAgents call

    const agentUrls = this.agents.map(agent => agent.url);
    console.log('Notifying agents about updated list:', agentUrls);
    for (const agent of this.agents) {
      try {
        await axios.post(`${agent.url}/agents/update`, { agentUrls });
        console.log(`Successfully notified agent at ${agent.url}`);
      } catch (error: any) {
        console.error(`Failed to notify agent at ${agent.url}:`, error.message);
      }
    }
  }

  private checkPort(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const server = net.createServer();
      server.once('error', (err: any) => {
        resolve(err.code !== 'EADDRINUSE');
      });
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });
  }

  private async findAvailablePort(startPort = 10000, endPort = 65535, maxAttempts = 100): Promise<number> {
    for (let i = 0; i < maxAttempts; i++) {
      const port = Math.floor(Math.random() * (endPort - startPort + 1)) + startPort;
      const isAvailable = await this.checkPort(port);
      if (isAvailable) {
        console.log(`Found available port: ${port}`);
        return port;
      }
    }
    throw new Error(`Could not find an available port after ${maxAttempts} attempts.`);
  }

  private async determinePort(requestedPort: number | null | undefined): Promise<number> {
      if (requestedPort && requestedPort > 0) {
        console.log(`Requested specific port: ${requestedPort}`);
        const isAvailable = await this.checkPort(requestedPort);
        if (isAvailable) {
          console.log(`Using requested port ${requestedPort}`);
          return requestedPort;
        } else {
          throw new Error(`Port ${requestedPort} is already in use.`);
        }
      } else {
        console.log('No specific port requested or port is 0, finding random available port...');
        return this.findAvailablePort();
      }
  }

  private waitForAgentStartup(
      kaProcess: ChildProcess,
      agentPort: number,
      agentUrl: string,
      name: string | undefined,
      description: string | undefined,
      model: string | undefined,
      systemPrompt: string | undefined,
      apiBaseUrl: string | undefined
    ): Promise<{ agent: Agent; logs: string[] }> { // Return logs along with agent
    return new Promise<{ agent: Agent; logs: string[] }>((resolve, reject) => {
      let resolved = false;
      let processError: Error | null = null;
      const startupTimeoutDuration = 15000; // 15 seconds
      const startupLogs: string[] = []; // Still store initial logs for historical query if needed
      const maxLogLines = 100;

      // Function to add log entry *during startup only* AND publish
      const addStartupLog = (message: string, stream: 'stdout' | 'stderr') => {
        const timestamp = new Date().toISOString();
        const line = message.trim();

        // Store historical log
        const logEntryForStorage = `[${timestamp}] [${stream}] ${line}`;
        startupLogs.push(logEntryForStorage);
        if (startupLogs.length > maxLogLines) {
          startupLogs.shift();
        }

        // Publish real-time log entry via PubSub
        // Note: Publishing might fail if agent ID isn't assigned yet,
        // but we'll publish anyway once the agent is created.
        // This function is called *before* the agent ID exists.
        // We need to publish *after* the agent is created and ID assigned.
        // Let's modify the flow: capture logs here, publish *after* agent creation.
      };


      const cleanupTimeout = (timeoutId: NodeJS.Timeout) => {
          clearTimeout(timeoutId);
          kaProcess.stdout?.removeAllListeners('data');
          kaProcess.stderr?.removeAllListeners('data');
          kaProcess.removeAllListeners('error');
          kaProcess.removeAllListeners('exit');
          kaProcess.removeAllListeners('close');
      };

      const handleStartupError = (errorMsg: string, timeoutId: NodeJS.Timeout, err?: Error) => {
        if (resolved) return;
        resolved = true;
        cleanupTimeout(timeoutId);
        console.error(`ka agent startup failed: ${errorMsg}`, err || '');
        if (kaProcess && !kaProcess.killed) {
          kaProcess.kill();
        }
        reject(new Error(`Failed to spawn agent: ${errorMsg}`));
      };

      const startupTimeout = setTimeout(() => {
        handleStartupError(`Startup timeout (${startupTimeoutDuration}ms). Agent did not confirm successful start.`, startupTimeout);
      }, startupTimeoutDuration);

      // Temporary listeners to capture startup output
      const startupStdoutListener = (data: Buffer) => {
        const output = data.toString();
        // Split potential multi-line output
        output.split('\n').forEach(line => {
          if (line) addStartupLog(line, 'stdout');
        });
        // console.log(`[ka stdout ${agentPort}]: ${output}`); // Keep console log for debugging
        if (output.includes(`Agent server running at http://localhost:${agentPort}/`) && !resolved) {
          resolved = true;
          cleanupTimeout(startupTimeout); // Cleanup timeout and listeners
          console.log(`ka agent on port ${agentPort} started successfully.`);
          const newAgent: Agent = {
            id: (this.agentIdCounter++).toString(),
            url: agentUrl,
            name: name || `Spawned ka Agent ${this.agentIdCounter - 1}`,
            description: description || `ka agent spawned with model: ${model || 'default'}`,
            isLocal: true,
          };
          // Resolve with agent and captured startup logs (for historical query)
          resolve({ agent: newAgent, logs: startupLogs });
        }
      };
      const startupStderrListener = (data: Buffer) => {
         const output = data.toString();
         // Split potential multi-line output
         output.split('\n').forEach(line => {
           if (line) addStartupLog(line, 'stderr');
         });
         // console.error(`[ka stderr ${agentPort}]: ${output}`); // Keep console log for debugging
         if (output.includes('address already in use') && output.includes(`:${agentPort}`)) {
           handleStartupError(`Port ${agentPort} already in use.`, startupTimeout);
         }
         processError = new Error(output.trim()); // Store last stderr line as potential error
      };

      kaProcess.stdout?.on('data', startupStdoutListener);
      kaProcess.stderr?.on('data', startupStderrListener);


      kaProcess.on('error', (err: Error) => {
        handleStartupError(`Process spawn error: ${err.message}`, startupTimeout, err);
      });

      kaProcess.on('exit', (code: number | null, signal: string | null) => {
        console.log(`ka process (port ${agentPort}) exited with code ${code} and signal ${signal}`);
        if (!resolved) {
          const exitMsg = `Process exited prematurely with code ${code}, signal ${signal}.`;
          handleStartupError(exitMsg, startupTimeout, processError || undefined);
        }
      });
    });
  }

  private setupProcessExitHandler(kaProcess: ChildProcess, agentId: string): void {
      kaProcess.on('exit', (code: number | null, signal: string | null) => {
          console.log(`Spawned agent process (ID: ${agentId}) exited after successful start with code ${code}, signal ${signal}.`);
          this.cleanupAgentData(agentId);
      });
  }

  // --- Agent Discovery Logic ---

  private async fetchAgentCapabilities(agent: Agent): Promise<void> {
    const url = `${agent.url}/.well-known/agent.json`;
    console.log(`Fetching capabilities for agent ${agent.id} from ${url}`);
    try {
      const response = await axios.get<AgentCapabilities>(url, { timeout: 5000 }); // 5 second timeout
      if (response.status === 200 && response.data) {
        agent.capabilities = response.data;
        // Update agent's name/description from capabilities if not set manually
        if (!agent.name && agent.capabilities.name) {
            agent.name = agent.capabilities.name;
        }
        if (!agent.description && agent.capabilities.description) {
            agent.description = agent.capabilities.description;
        }
        console.log(`Successfully fetched capabilities for agent ${agent.id}:`, agent.capabilities.description);
      } else {
        console.warn(`Failed to fetch capabilities for agent ${agent.id}: Status ${response.status}`);
        agent.capabilities = null;
      }
    } catch (error: any) {
      console.error(`Error fetching capabilities for agent ${agent.id} (${url}):`, error.message);
      agent.capabilities = null;
    }
  }

  // Simple keyword overlap matching (placeholder)
  private calculateMatchScore(taskPrompt: string, agentDescription: string): number {
    if (!agentDescription) return 0;
    const taskWords = new Set(taskPrompt.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    const agentWords = new Set(agentDescription.toLowerCase().split(/\W+/).filter(w => w.length > 2));
    let intersectionSize = 0;
    taskWords.forEach(word => {
      if (agentWords.has(word)) {
        intersectionSize++;
      }
    });
    return intersectionSize;
  }

  public async findBestAgentForTask(taskPrompt: string): Promise<Agent | null> {
    console.log(`Finding best agent for task: "${taskPrompt}"`);
    let bestAgent: Agent | null = null;
    let highestScore = -1;

    // Ensure capabilities are fetched for agents that might be missing them
    // (e.g., if added before this logic or fetch failed previously)
    // In a production system, periodic refresh is better.
    for (const agent of this.agents) {
        if (agent.capabilities === undefined) { // Check if undefined (never fetched)
            await this.fetchAgentCapabilities(agent);
        }
    }


    for (const agent of this.agents) {
      if (agent.capabilities?.description) {
        const score = this.calculateMatchScore(taskPrompt, agent.capabilities.description);
        console.log(`Agent ${agent.id} (${agent.name}) score: ${score} (Desc: ${agent.capabilities.description.substring(0, 50)}...)`);
        if (score > highestScore) {
          highestScore = score;
          bestAgent = agent;
        }
      } else {
         console.log(`Agent ${agent.id} (${agent.name}) has no capabilities description, score: 0`);
      }
    }

    if (bestAgent && highestScore > 0) {
      console.log(`Best agent found: ${bestAgent.id} (${bestAgent.name}) with score ${highestScore}`);
      return bestAgent;
    } else {
      console.log('No suitable agent found based on description matching.');
      // Fallback or error handling needed here? Maybe return a default agent?
      return null;
    }
  }

  // Method to fetch tasks from a specific agent
  public async getAgentTasks(agentId: string): Promise<any[]> { // Using any[] for now, refine later
    const agent = this.agents.find(a => a.id === agentId);
    if (!agent) {
      console.error(`[getAgentTasks] Agent with ID ${agentId} not found.`);
      throw new Error(`Agent with ID ${agentId} not found.`);
    }

    const agentUrl = agent.url; // Root URL for JSON-RPC
    const requestId = `list-tasks-${agentId}-${Date.now()}`;
    const requestBody = {
      jsonrpc: "2.0",
      method: "tasks/list",
      id: requestId,
    };

    console.log(`[getAgentTasks] Sending tasks/list request to agent ${agentId} at ${agentUrl}`);

    try {
      const response = await axios.post(agentUrl, requestBody, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000, // 10 second timeout
      });

      // Check for JSON-RPC level errors
      if (response.data.error) {
        console.error(`[getAgentTasks] JSON-RPC error from agent ${agentId}:`, response.data.error);
        throw new Error(`Agent ${agentId} returned error: ${response.data.error.message} (Code: ${response.data.error.code})`);
      }

      // Check if result is present and is an array
      if (response.data.result && Array.isArray(response.data.result)) {
        console.log(`[getAgentTasks] Received ${response.data.result.length} tasks from agent ${agentId}`);
        return response.data.result;
      } else {
        // Handle cases where result is missing or not an array (unexpected response)
        console.warn(`[getAgentTasks] Unexpected response format from agent ${agentId}. Result was not an array or was missing. Response:`, response.data);
        // Return empty array or throw error based on desired strictness
        return [];
      }

    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        console.error(`[getAgentTasks] Axios error fetching tasks from agent ${agentId} (${agentUrl}): ${error.message}`, error.response?.data);
        throw new Error(`Failed to communicate with agent ${agentId}: ${error.message}`);
      } else {
        console.error(`[getAgentTasks] Non-Axios error fetching tasks from agent ${agentId}:`, error);
        throw new Error(`An unexpected error occurred while fetching tasks from agent ${agentId}.`);
      }
    }
  }
}
