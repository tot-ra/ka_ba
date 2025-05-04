import axios from 'axios';
import { Agent, AgentRegistry } from './agentRegistry.js';
import { Task } from '../a2aClient.js'; // Assuming this path is correct

export class AgentTaskService {
  private agentRegistry: AgentRegistry;

  constructor(agentRegistry: AgentRegistry) {
    this.agentRegistry = agentRegistry;
  }

  public async getAgentTasks(agentId: string): Promise<any[]> {
    const agent = this.agentRegistry.findAgent(agentId);
    if (!agent) {
      console.error(`[getAgentTasks] Agent with ID ${agentId} not found.`);
      throw new Error(`Agent with ID ${agentId} not found.`);
    }

    const agentUrl = agent.url;
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
        timeout: 10000,
      });

      if (response.data.error) {
        console.error(`[getAgentTasks] JSON-RPC error from agent ${agentId}:`, response.data.error);
        throw new Error(`Agent ${agentId} returned error: ${response.data.error.message} (Code: ${response.data.error.code})`);
      }

      if (response.data.result && Array.isArray(response.data.result)) {
        console.log(`[getAgentTasks] Received ${response.data.result.length} tasks from agent ${agentId}`);
        return response.data.result;
      } else {
        console.warn(`[getAgentTasks] Unexpected response format from agent ${agentId}. Result was not an array or was missing. Response:`, response.data);
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

  public async getAgentTaskDetails(agentId: string, taskId: string): Promise<Task | null> {
      const agent = this.agentRegistry.findAgent(agentId);
      if (!agent) {
          console.error(`[getAgentTaskDetails] Agent with ID ${agentId} not found.`);
          throw new Error(`Agent with ID ${agentId} not found.`);
      }

      if (!agent.capabilities?.endpoints?.tasks_status) {
          console.warn(`[getAgentTaskDetails] Agent ${agentId} does not support tasks_status endpoint.`);
          return null;
      }

      const statusEndpoint = `${agent.url}${agent.capabilities.endpoints.tasks_status}`;
      const requestId = `get-task-${agentId}-${taskId}-${Date.now()}`;
      const requestBody = {
          jsonrpc: "2.0",
          method: "tasks/status",
          params: { id: taskId },
          id: requestId,
      };

      console.log(`[getAgentTaskDetails] Sending tasks/status request for task ${taskId} to agent ${agentId} at ${statusEndpoint}`);

      try {
          const response = await axios.post(statusEndpoint, requestBody, {
              headers: { 'Content-Type': 'application/json' },
              timeout: 5000,
          });

          if (response.data.error) {
              console.error(`[getAgentTaskDetails] JSON-RPC error from agent ${agentId} for task ${taskId}:`, response.data.error);
              throw new Error(`Agent ${agentId} returned error for task ${taskId}: ${response.data.error.message} (Code: ${response.data.error.code})`);
          }

          if (response.data.result) {
              console.log(`[getAgentTaskDetails] Received task details for task ${taskId} from agent ${agentId}`);
              return response.data.result as Task;
          } else {
              console.warn(`[getAgentTaskDetails] Unexpected response format from agent ${agentId} for task ${taskId}. Result was missing. Response:`, response.data);
              return null;
          }

      } catch (error: any) {
          if (axios.isAxiosError(error)) {
              console.error(`[getAgentTaskDetails] Axios error fetching task ${taskId} from agent ${agentId} (${statusEndpoint}): ${error.message}`, error.response?.data);
              throw new Error(`Failed to communicate with agent ${agentId} for task ${taskId}: ${error.message}`);
          } else {
              console.error(`[getAgentTaskDetails] Non-Axios error fetching task ${taskId} from agent ${agentId}:`, error);
              throw new Error(`An unexpected error occurred while fetching task ${taskId} from agent ${agentId}.`);
          }
      }
  }
}
