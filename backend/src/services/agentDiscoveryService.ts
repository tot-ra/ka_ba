import axios from 'axios';
import { Agent, AgentRegistry } from './agentRegistry.js';

interface AgentCapabilities {
  name: string;
  description: string;
  url: string;
  api_version: string;
  protocol_version: string;
  endpoints: {
    tasks_send: string;
    tasks_send_subscribe?: string;
    tasks_status: string;
    tasks_artifact?: string;
  };
  authentication: string[];
}

export class AgentDiscoveryService {
  private agentRegistry: AgentRegistry;

  constructor(agentRegistry: AgentRegistry) {
    this.agentRegistry = agentRegistry;
  }

  public async fetchAgentCapabilities(agent: Agent): Promise<void> {
    const url = `${agent.url}/.well-known/agent.json`;
    console.log(`Fetching capabilities for agent ${agent.id} from ${url}`);
    try {
      const response = await axios.get<AgentCapabilities>(url, { timeout: 5000 });
      if (response.status === 200 && response.data) {
        agent.capabilities = response.data;
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

    const agents = this.agentRegistry.getAgents();

    for (const agent of agents) {
        if (agent.capabilities === undefined) {
            await this.fetchAgentCapabilities(agent);
        }
    }

    for (const agent of agents) {
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
      return null;
    }
  }
}
