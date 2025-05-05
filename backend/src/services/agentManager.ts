import { EventEmitter } from 'node:events';
import { Agent, AgentRegistry } from './agentRegistry.js'; // Import Agent from agentRegistry
import { LocalAgentManager } from './localAgentManager.js';
import { AgentDiscoveryService } from './agentDiscoveryService.js';
import { AgentTaskService } from './agentTaskService.js';
import { AgentSubscriptionService } from './agentSubscriptionService.js';
import { LogManager } from './logManager.js';
import { PortManager } from './portManager.js';
import axios from 'axios'; // Import axios

export class AgentManager {
  private agentRegistry: AgentRegistry;
  private localAgentManager: LocalAgentManager;
  private agentDiscoveryService: AgentDiscoveryService;
  private agentTaskService: AgentTaskService;
  private agentSubscriptionService: AgentSubscriptionService;
  private logManager: LogManager;
  private portManager: PortManager;
  private eventEmitter: EventEmitter;

  constructor(eventEmitter: EventEmitter) {
    this.eventEmitter = eventEmitter;
    this.agentRegistry = new AgentRegistry(eventEmitter);
    this.portManager = new PortManager();
    this.logManager = new LogManager(eventEmitter);
    this.localAgentManager = new LocalAgentManager(this.agentRegistry, this.portManager, this.logManager, eventEmitter);
    this.agentDiscoveryService = new AgentDiscoveryService(this.agentRegistry);
    this.agentTaskService = new AgentTaskService(this.agentRegistry);
    this.agentSubscriptionService = new AgentSubscriptionService(this.agentRegistry, this.agentTaskService, eventEmitter);
  }

  public getAgents(): (Agent & { pid?: number })[] {
    return this.agentRegistry.getAgents().map(agent => {
      if (agent.isLocal) {
        const processInfo = this.localAgentManager.getSpawnedProcessInfo(agent.id);
        return {
          ...agent,
          pid: processInfo?.pid,
        };
      }
      return agent;
    });
  }

  public addRemoteAgent(url: string, name?: string): Agent {
    const newAgent = this.agentRegistry.addRemoteAgent(url, name);
    this.agentDiscoveryService.fetchAgentCapabilities(newAgent);
    if (newAgent.capabilities?.endpoints?.tasks_send_subscribe) {
        this.agentSubscriptionService.subscribeToAgentTaskUpdates(newAgent.id);
    }
    return newAgent;
  }

  public removeAgent(id: string): boolean {
    const agent = this.agentRegistry.findAgent(id);
    if (!agent) {
        return false;
    }

    this.agentSubscriptionService.stopAgentTaskSubscription(id);

    if (agent.isLocal) {
        this.localAgentManager.stopLocalAgent(id);
    } else {
        this.agentRegistry.removeAgent(id);
        this.logManager.removeAgentLogs(id);
    }
    return true;
  }

  public async spawnLocalAgent(args: { model?: string, systemPrompt?: string, apiBaseUrl?: string, port?: number | null, name?: string, description?: string }): Promise<Agent | null> {
    const newAgent = await this.localAgentManager.spawnLocalAgent(args);
    if (newAgent) {
        this.agentDiscoveryService.fetchAgentCapabilities(newAgent);
        if (newAgent.capabilities?.endpoints?.tasks_send_subscribe) {
            this.agentSubscriptionService.subscribeToAgentTaskUpdates(newAgent.id);
        }
    }
    return newAgent;
  }

  public async findBestAgentForTask(taskPrompt: string): Promise<Agent | null> {
    return this.agentDiscoveryService.findBestAgentForTask(taskPrompt);
  }

  // New method to update a local agent's system prompt
  public async updateAgentSystemPrompt(agentId: string, systemPrompt: string): Promise<Agent> {
    const agent = this.agentRegistry.findAgent(agentId);
    if (!agent) {
      throw new Error(`Agent with ID ${agentId} not found.`);
    }

    if (!agent.isLocal) {
      throw new Error(`Agent with ID ${agentId} is not a local agent and does not support system prompt updates via this method.`);
    }

    try {
      const updateUrl = `${agent.url.replace(/\/+$/, '')}/system-prompt`; // Ensure no double slash
      console.log(`[AgentManager] Updating system prompt for agent ${agentId} at ${updateUrl}`);
      const response = await axios.put(updateUrl, { systemPrompt }); // Use PUT and send systemPrompt in body

      if (response.status !== 200) {
        console.error(`[AgentManager] Unexpected response status from agent ${agentId} /system-prompt endpoint: ${response.status}`);
        throw new Error(`Agent ${agentId} returned unexpected status ${response.status} when updating system prompt.`);
      }

      console.log(`[AgentManager] System prompt updated successfully for agent ${agentId}.`);
      // Optionally refetch agent capabilities/card if the update changes them
      // this.agentDiscoveryService.fetchAgentCapabilities(agent);
      return agent; // Return the updated agent object (or just the original one)
    } catch (error: any) {
      console.error(`[AgentManager] Error updating system prompt for agent ${agentId}:`, error);
      throw new Error(`Failed to update system prompt for agent ${agentId}: ${error.message}`);
    }
  }

  public async getAgentTasks(agentId: string): Promise<any[]> {
    return this.agentTaskService.getAgentTasks(agentId);
  }

  public async getAgentTaskDetails(agentId: string, taskId: string): Promise<any | null> {
      return this.agentTaskService.getAgentTaskDetails(agentId, taskId);
  }

  public getAgentLogs(agentId: string): string[] | null {
      return this.logManager.getAgentLogs(agentId);
  }
}
