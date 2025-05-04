import { EventEmitter } from 'node:events';
import { Agent, AgentRegistry } from './agentRegistry.js';
import { LocalAgentManager } from './localAgentManager.js';
import { AgentDiscoveryService } from './agentDiscoveryService.js';
import { AgentTaskService } from './agentTaskService.js';
import { AgentSubscriptionService } from './agentSubscriptionService.js';
import { LogManager } from './logManager.js';
import { PortManager } from './portManager.js';

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
