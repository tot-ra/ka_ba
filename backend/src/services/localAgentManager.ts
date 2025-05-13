import { spawn, ChildProcess } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Agent, AgentRegistry } from './agentRegistry.js';
import { PortManager } from './portManager.js';
import { LogManager } from './logManager.js';
import { EventEmitter } from 'node:events';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SpawnedProcessInfo {
  process: ChildProcess;
  pid: number;
  port: number;
  config: {
    llmProvider?: string;
    llmModel?: string;
    llmApiBaseUrl?: string;
    llmApiKey?: string;
    systemPrompt?: string;
  };
}

export class LocalAgentManager {
  private spawnedProcesses: Map<string, SpawnedProcessInfo> = new Map();
  private agentRegistry: AgentRegistry;
  private portManager: PortManager;
  private logManager: LogManager;
  private eventEmitter: EventEmitter;

  constructor(agentRegistry: AgentRegistry, portManager: PortManager, logManager: LogManager, eventEmitter: EventEmitter) {
    this.agentRegistry = agentRegistry;
    this.portManager = portManager;
    this.logManager = logManager;
    this.eventEmitter = eventEmitter;
  }

  public async spawnLocalAgent(args: { llmProvider?: string, llmModel?: string, llmApiBaseUrl?: string, llmApiKey?: string, systemPrompt?: string, port?: number | null, name?: string, description?: string }): Promise<Agent | null> {
    const { llmProvider, llmModel, llmApiBaseUrl, llmApiKey, systemPrompt, port: requestedPort, name, description } = args;
    console.log('Attempting to spawn ka agent with:', { llmProvider, llmModel, llmApiBaseUrl, llmApiKey: llmApiKey ? '***' : 'undefined', systemPrompt, port: requestedPort, name, description }); // Mask API key in logs

    const env: NodeJS.ProcessEnv = { ...process.env };
    if (llmProvider) env.LLM_PROVIDER_TYPE = llmProvider;
    if (llmModel) env.LLM_MODEL = llmModel;
    if (llmApiBaseUrl) env.LLM_API_BASE = llmApiBaseUrl;
    if (llmApiKey) env.GEMINI_API_KEY = llmApiKey; // Pass Gemini API key as specific env var

    const kaExecutablePath = join(__dirname, '..', '..', '..', 'ka', 'ka');
    console.log(`Calculated absolute path for ka executable: ${kaExecutablePath}`);

    let agentPort: number;
    try {
      agentPort = await this.portManager.determinePort(requestedPort);
    } catch (error: any) {
      console.error("Failed to determine port for ka agent:", error);
      return null;
    }

    env.PORT = agentPort.toString();
    const agentUrl = `http://localhost:${agentPort}`;
    console.log(`Attempting to spawn ka agent at ${agentUrl} using PORT=${agentPort}`);

    // Assign a unique ID to the new agent *before* spawning so we can use it for the task directory
    const newAgentId = this.agentRegistry.getNextAgentId();

    // Set the TASK_STORE_DIR environment variable for the spawned process
    const taskStoreDir = `kaba/backend/_tasks/${newAgentId}`;
    env.TASK_STORE_DIR = taskStoreDir;
    console.log(`Setting TASK_STORE_DIR for agent ${newAgentId}: ${taskStoreDir}`);

    const kaArgs = [];
    if (name) kaArgs.push('--name', name);
    if (description) kaArgs.push('--description', description);
    if (llmModel) kaArgs.push('--model', llmModel); // Pass model as arg
    if (systemPrompt) kaArgs.push('--system-prompt', systemPrompt); // Pass system prompt as arg
    if (llmProvider) kaArgs.push('--llm-provider', llmProvider); // Pass provider as arg
    if (llmApiKey) kaArgs.push('--gemini-api-key', llmApiKey); // Pass gemini api key as arg
    kaArgs.push('server');
    console.log('Spawning ka with args:', kaArgs);

    const kaProcess = spawn(kaExecutablePath, kaArgs, {
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    kaProcess.unref();

    try {
      const newAgent = await this.waitForAgentStartup(newAgentId, kaProcess, agentPort, agentUrl, name, description, llmProvider, llmModel, llmApiBaseUrl, llmApiKey, systemPrompt);

      this.agentRegistry.addAgent(newAgent);

      if (typeof kaProcess.pid === 'number') {
        this.spawnedProcesses.set(newAgent.id, {
          process: kaProcess,
          pid: kaProcess.pid,
          port: agentPort,
          config: { llmProvider, llmModel, llmApiBaseUrl, llmApiKey, systemPrompt },
        });
        console.log(`Stored spawned process info for agent ID: ${newAgent.id} with PID: ${kaProcess.pid} on port ${agentPort}`);

        this.setupOngoingLogCapture(kaProcess, newAgent.id);

      } else {
         console.error(`Process started for agent ${newAgent.id} but PID is missing.`);
         kaProcess.kill();
         this.agentRegistry.removeAgent(newAgent.id);
         throw new Error('Process started but PID is missing.');
      }

      this.setupProcessExitHandler(kaProcess, newAgent.id);
      return newAgent;

    } catch (error: unknown) {
      console.error("Error during spawnLocalAgent execution:", error);
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
      const agent = this.agentRegistry.findAgent(id);
      if (agent && agent.isLocal) {
          console.log(`Agent ${id} found in registry but not in spawned processes. Removing from registry.`);
          this.agentRegistry.removeAgent(id);
          this.logManager.removeAgentLogs(id);
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
      this.agentRegistry.removeAgent(agentId);
      this.logManager.removeAgentLogs(agentId);
  }

  private setupOngoingLogCapture(kaProcess: ChildProcess, agentId: string): void {
    const handleData = (data: Buffer, stream: 'stdout' | 'stderr') => {
      const rawData = data.toString();
      const lines = rawData.split('\n');
      lines.forEach((line, index) => {
        if (line || (index === lines.length - 1 && lines.length > 1)) {
           this.logManager.addLog(agentId, line, stream);
        }
      });
    };

    kaProcess.stdout?.on('data', (data: Buffer) => handleData(data, 'stdout'));
    kaProcess.stderr?.on('data', (data: Buffer) => handleData(data, 'stderr'));
  }

  private waitForAgentStartup(
      agentId: string,
      kaProcess: ChildProcess,
      agentPort: number,
      agentUrl: string,
      name: string | undefined,
      description: string | undefined,
      llmProvider: string | undefined,
      llmModel: string | undefined,
      llmApiBaseUrl: string | undefined,
      llmApiKey: string | undefined,
      systemPrompt: string | undefined
    ): Promise<Agent> {
    return new Promise<Agent>((resolve, reject) => {
      let resolved = false;
      let processError: Error | null = null;
      const startupTimeoutDuration = 15000;

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

      const startupStdoutListener = (data: Buffer) => {
        const output = data.toString();
        if (output.includes(`Agent server running at http://localhost:${agentPort}/`) && !resolved) {
          resolved = true;
          cleanupTimeout(startupTimeout);
          console.log(`ka agent on port ${agentPort} started successfully.`);
          const newAgent: Agent = {
            id: agentId,
            url: agentUrl,
            name: name || `Spawned ka Agent ${agentId}`,
            description: description || `ka agent spawned with provider: ${llmProvider || 'default'}, model: ${llmModel || 'default'}`,
            isLocal: true,
            llmProvider,
            llmModel,
            llmApiBaseUrl,
            llmApiKey,
            systemPrompt,
          };
          resolve(newAgent);
        }
      };
      const startupStderrListener = (data: Buffer) => {
         const output = data.toString();
         if (output.includes('address already in use') && output.includes(`:${agentPort}`)) {
           handleStartupError(`Port ${agentPort} already in use.`, startupTimeout);
         }
         processError = new Error(output.trim());
      };

      kaProcess.stdout?.on('data', startupStdoutListener);
      kaProcess.stderr?.on('data', startupStderrListener);

      kaProcess.on('error', (err: Error) => {
        handleStartupError(`Process spawn error: ${err.message}`, startupTimeout, err);
      });

      kaProcess.on('exit', (code: number | null, signal: string | null) => {
        console.log(`ka process (port ${agentPort}) exited with code ${code}, signal ${signal}.`);
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

  public getSpawnedProcessInfo(agentId: string): SpawnedProcessInfo | undefined {
      return this.spawnedProcesses.get(agentId);
  }
}
