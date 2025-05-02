import { spawn, ChildProcess } from 'child_process';
import { join } from 'path';
import net from 'net';
import axios from 'axios';
// Removed Orchestrator import

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
  // Removed orchestrator property

  // Removed orchestrator from constructor
  constructor() {
    // Removed orchestrator.updateAgents call
  }

  public getAgents(): Agent[] {
    return [...this.agents];
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

    const kaExecutablePath = join(__dirname, '..', '..', '..', '..', 'ka', 'ka');
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
      const newAgent = await this.waitForAgentStartup(kaProcess, agentPort, agentUrl, name, description, model, systemPrompt, apiBaseUrl);
      this.agents.push(newAgent);
      console.log(`Added spawned agent: ${newAgent.url}`);
      this.notifyAgents();

      if (typeof kaProcess.pid === 'number') {
        this.spawnedProcesses.set(newAgent.id, {
          process: kaProcess,
          pid: kaProcess.pid,
          port: agentPort,
          config: { model, systemPrompt, apiBaseUrl },
        });
          console.log(`Stored spawned process info for agent ID: ${newAgent.id} with PID: ${kaProcess.pid} on port ${agentPort}`);
      } else {
         console.error(`Process started for agent ${newAgent.id} but PID is missing.`);
         kaProcess.kill();
         this.agents = this.agents.filter(a => a.id !== newAgent.id);
         this.notifyAgents();
         throw new Error('Process started but PID is missing.');
      }

      this.setupProcessExitHandler(kaProcess, newAgent.id);
      this.fetchAgentCapabilities(newAgent); // Fetch capabilities after startup
      return newAgent;

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
    ): Promise<Agent> {
    return new Promise<Agent>((resolve, reject) => {
      let resolved = false;
      let processError: Error | null = null;
      const startupTimeoutDuration = 15000; // 15 seconds

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

      kaProcess.stdout?.on('data', (data: Buffer) => {
        const output = data.toString();
        console.log(`[ka stdout ${agentPort}]: ${output}`);
        if (output.includes(`Agent server running at http://localhost:${agentPort}/`) && !resolved) {
          resolved = true;
          cleanupTimeout(startupTimeout);
          console.log(`ka agent on port ${agentPort} started successfully.`);
          const newAgent: Agent = {
            id: (this.agentIdCounter++).toString(),
            url: agentUrl,
            name: name || `Spawned ka Agent ${this.agentIdCounter - 1}`,
            description: description || `ka agent spawned with model: ${model || 'default'}`,
            isLocal: true,
          };
          resolve(newAgent);
        }
      });

      kaProcess.stderr?.on('data', (data: Buffer) => {
        const output = data.toString();
        console.error(`[ka stderr ${agentPort}]: ${output}`);
        if (output.includes('address already in use') && output.includes(`:${agentPort}`)) {
          handleStartupError(`Port ${agentPort} already in use.`, startupTimeout);
        }
        processError = new Error(output.trim());
      });

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
}
