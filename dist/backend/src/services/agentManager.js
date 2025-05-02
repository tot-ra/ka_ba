"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgentManager = void 0;
const child_process_1 = require("child_process");
const path_1 = require("path");
const net_1 = __importDefault(require("net"));
const axios_1 = __importDefault(require("axios"));
class AgentManager {
    // Removed orchestrator property
    // Removed orchestrator from constructor
    constructor() {
        this.agents = [];
        this.spawnedProcesses = new Map();
        this.agentIdCounter = 1;
        // Removed orchestrator.updateAgents call
    }
    getAgents() {
        return [...this.agents];
    }
    addRemoteAgent(url, name) {
        const newAgent = {
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
    removeAgent(id) {
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
    async spawnLocalAgent(args) {
        const { model, systemPrompt, apiBaseUrl, port: requestedPort, name, description } = args;
        console.log('Attempting to spawn ka agent with:', { model, systemPrompt, apiBaseUrl, port: requestedPort, name, description });
        const env = { ...process.env };
        if (model)
            env.LLM_MODEL = model;
        if (systemPrompt)
            env.LLM_SYSTEM_MESSAGE = systemPrompt;
        if (apiBaseUrl)
            env.LLM_API_BASE = apiBaseUrl;
        const kaExecutablePath = (0, path_1.join)(__dirname, '..', '..', '..', '..', 'ka', 'ka');
        console.log(`Calculated absolute path for ka executable: ${kaExecutablePath}`);
        let agentPort;
        try {
            agentPort = await this.determinePort(requestedPort);
        }
        catch (error) {
            console.error("Failed to determine port for ka agent:", error);
            return null;
        }
        env.PORT = agentPort.toString();
        const agentUrl = `http://localhost:${agentPort}`;
        console.log(`Attempting to spawn ka agent at ${agentUrl} using PORT=${agentPort}`);
        const kaArgs = [];
        if (name)
            kaArgs.push('--name', name);
        if (description)
            kaArgs.push('--description', description);
        if (model)
            kaArgs.push('--model', model);
        kaArgs.push('server');
        console.log('Spawning ka with args:', kaArgs);
        const kaProcess = (0, child_process_1.spawn)(kaExecutablePath, kaArgs, {
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
            }
            else {
                console.error(`Process started for agent ${newAgent.id} but PID is missing.`);
                kaProcess.kill();
                this.agents = this.agents.filter(a => a.id !== newAgent.id);
                this.notifyAgents();
                throw new Error('Process started but PID is missing.');
            }
            this.setupProcessExitHandler(kaProcess, newAgent.id); // Keep exit handler separate
            this.fetchAgentCapabilities(newAgent); // Fetch capabilities after startup
            return newAgent; // Return only the agent object as before
        }
        catch (error) {
            console.error("Error during spawnKaAgent execution:", error);
            if (kaProcess && !kaProcess.killed) {
                console.log("Ensuring failed kaProcess is killed.");
                kaProcess.kill();
            }
            return null;
        }
    }
    stopLocalAgent(id) {
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
    stopLocalAgentProcess(agentId, info) {
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
        }
        catch (err) {
            console.error(`Failed to stop process with PID ${info.pid}: ${err}`);
            if (err.code === 'ESRCH') {
                console.log(`Process with PID ${info.pid} not found (ESRCH). Assuming already stopped.`);
                this.cleanupAgentData(agentId);
                return true;
            }
            return false;
        }
    }
    cleanupAgentData(agentId) {
        this.spawnedProcesses.delete(agentId);
        const agentIndex = this.agents.findIndex(agent => agent.id === agentId);
        if (agentIndex > -1) {
            this.agents.splice(agentIndex, 1);
            console.log(`Removed agent with ID: ${agentId} from agents list`);
            this.notifyAgents();
        }
    }
    // --- Log Management ---
    _addLog(agentId, message, stream) {
        const processInfo = this.spawnedProcesses.get(agentId);
        if (processInfo) {
            const maxLogLines = 100; // Consistent max log lines
            const logEntry = `[${new Date().toISOString()}] [${stream}] ${message.trim()}`;
            processInfo.logs.push(logEntry);
            if (processInfo.logs.length > maxLogLines) {
                processInfo.logs.shift(); // Remove the oldest log line
            }
        }
        else {
            console.warn(`Attempted to add log for non-existent or cleaned up agent process: ${agentId}`);
        }
    }
    setupOngoingLogCapture(kaProcess, agentId) {
        kaProcess.stdout?.on('data', (data) => {
            const output = data.toString();
            this._addLog(agentId, output, 'stdout');
            // console.log(`[ka stdout ${agentId}]: ${output}`); // Optional: Keep for backend debugging
        });
        kaProcess.stderr?.on('data', (data) => {
            const output = data.toString();
            this._addLog(agentId, output, 'stderr');
            // console.error(`[ka stderr ${agentId}]: ${output}`); // Optional: Keep for backend debugging
        });
    }
    getAgentLogs(agentId) {
        const processInfo = this.spawnedProcesses.get(agentId);
        return processInfo ? processInfo.logs : null;
    }
    // --- Agent Notification & Port Management ---
    async notifyAgents() {
        // Removed orchestrator.updateAgents call
        const agentUrls = this.agents.map(agent => agent.url);
        console.log('Notifying agents about updated list:', agentUrls);
        for (const agent of this.agents) {
            try {
                await axios_1.default.post(`${agent.url}/agents/update`, { agentUrls });
                console.log(`Successfully notified agent at ${agent.url}`);
            }
            catch (error) {
                console.error(`Failed to notify agent at ${agent.url}:`, error.message);
            }
        }
    }
    checkPort(port) {
        return new Promise((resolve) => {
            const server = net_1.default.createServer();
            server.once('error', (err) => {
                resolve(err.code !== 'EADDRINUSE');
            });
            server.once('listening', () => {
                server.close(() => resolve(true));
            });
            server.listen(port, '127.0.0.1');
        });
    }
    async findAvailablePort(startPort = 10000, endPort = 65535, maxAttempts = 100) {
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
    async determinePort(requestedPort) {
        if (requestedPort && requestedPort > 0) {
            console.log(`Requested specific port: ${requestedPort}`);
            const isAvailable = await this.checkPort(requestedPort);
            if (isAvailable) {
                console.log(`Using requested port ${requestedPort}`);
                return requestedPort;
            }
            else {
                throw new Error(`Port ${requestedPort} is already in use.`);
            }
        }
        else {
            console.log('No specific port requested or port is 0, finding random available port...');
            return this.findAvailablePort();
        }
    }
    waitForAgentStartup(kaProcess, agentPort, agentUrl, name, description, model, systemPrompt, apiBaseUrl) {
        return new Promise((resolve, reject) => {
            let resolved = false;
            let processError = null;
            const startupTimeoutDuration = 15000; // 15 seconds
            const startupLogs = []; // Temporary log storage during startup
            const maxLogLines = 100; // Max log lines to keep - Note: This is now also defined in _addLog
            // Function to add log entry *during startup only*
            const addStartupLog = (message, stream) => {
                const logEntry = `[${new Date().toISOString()}] [${stream}] ${message.trim()}`;
                startupLogs.push(logEntry);
                if (startupLogs.length > maxLogLines) {
                    startupLogs.shift(); // Remove the oldest log line
                }
            };
            const cleanupTimeout = (timeoutId) => {
                clearTimeout(timeoutId);
                kaProcess.stdout?.removeAllListeners('data');
                kaProcess.stderr?.removeAllListeners('data');
                kaProcess.removeAllListeners('error');
                kaProcess.removeAllListeners('exit');
                kaProcess.removeAllListeners('close');
            };
            const handleStartupError = (errorMsg, timeoutId, err) => {
                if (resolved)
                    return;
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
            kaProcess.stdout?.on('data', (data) => {
                const output = data.toString();
                addStartupLog(output, 'stdout'); // Capture stdout during startup
                // console.log(`[ka stdout ${agentPort}]: ${output}`); // Keep console log for debugging
                if (output.includes(`Agent server running at http://localhost:${agentPort}/`) && !resolved) {
                    resolved = true;
                    // Important: Remove startup listeners before resolving
                    // to avoid duplicate logging after setupOngoingLogCapture is called.
                    kaProcess.stdout?.removeAllListeners('data');
                    kaProcess.stderr?.removeAllListeners('data');
                    cleanupTimeout(startupTimeout);
                    console.log(`ka agent on port ${agentPort} started successfully.`);
                    const newAgent = {
                        id: (this.agentIdCounter++).toString(),
                        url: agentUrl,
                        name: name || `Spawned ka Agent ${this.agentIdCounter - 1}`,
                        description: description || `ka agent spawned with model: ${model || 'default'}`,
                        isLocal: true,
                    };
                    resolve({ agent: newAgent, logs: startupLogs }); // Resolve with agent and logs
                }
            });
            kaProcess.stderr?.on('data', (data) => {
                const output = data.toString();
                addStartupLog(output, 'stderr'); // Capture stderr during startup
                // console.error(`[ka stderr ${agentPort}]: ${output}`); // Keep console log for debugging
                if (output.includes('address already in use') && output.includes(`:${agentPort}`)) {
                    handleStartupError(`Port ${agentPort} already in use.`, startupTimeout);
                }
                processError = new Error(output.trim());
            });
            kaProcess.on('error', (err) => {
                handleStartupError(`Process spawn error: ${err.message}`, startupTimeout, err);
            });
            kaProcess.on('exit', (code, signal) => {
                console.log(`ka process (port ${agentPort}) exited with code ${code} and signal ${signal}`);
                if (!resolved) {
                    const exitMsg = `Process exited prematurely with code ${code}, signal ${signal}.`;
                    handleStartupError(exitMsg, startupTimeout, processError || undefined);
                }
            });
        });
    }
    setupProcessExitHandler(kaProcess, agentId) {
        kaProcess.on('exit', (code, signal) => {
            console.log(`Spawned agent process (ID: ${agentId}) exited after successful start with code ${code}, signal ${signal}.`);
            this.cleanupAgentData(agentId);
        });
    }
    // --- Agent Discovery Logic ---
    async fetchAgentCapabilities(agent) {
        const url = `${agent.url}/.well-known/agent.json`;
        console.log(`Fetching capabilities for agent ${agent.id} from ${url}`);
        try {
            const response = await axios_1.default.get(url, { timeout: 5000 }); // 5 second timeout
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
            }
            else {
                console.warn(`Failed to fetch capabilities for agent ${agent.id}: Status ${response.status}`);
                agent.capabilities = null;
            }
        }
        catch (error) {
            console.error(`Error fetching capabilities for agent ${agent.id} (${url}):`, error.message);
            agent.capabilities = null;
        }
    }
    // Simple keyword overlap matching (placeholder)
    calculateMatchScore(taskPrompt, agentDescription) {
        if (!agentDescription)
            return 0;
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
    async findBestAgentForTask(taskPrompt) {
        console.log(`Finding best agent for task: "${taskPrompt}"`);
        let bestAgent = null;
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
            }
            else {
                console.log(`Agent ${agent.id} (${agent.name}) has no capabilities description, score: 0`);
            }
        }
        if (bestAgent && highestScore > 0) {
            console.log(`Best agent found: ${bestAgent.id} (${bestAgent.name}) with score ${highestScore}`);
            return bestAgent;
        }
        else {
            console.log('No suitable agent found based on description matching.');
            // Fallback or error handling needed here? Maybe return a default agent?
            return null;
        }
    }
}
exports.AgentManager = AgentManager;
