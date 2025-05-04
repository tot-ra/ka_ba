import { EventEmitter } from 'node:events';
import { Agent, AgentRegistry } from './agentRegistry.js';
import { AgentTaskService } from './agentTaskService.js';
import { Task } from '../a2aClient.js'; // Assuming this path is correct

export class AgentSubscriptionService {
  private agentRegistry: AgentRegistry;
  private agentTaskService: AgentTaskService;
  private eventEmitter: EventEmitter;
  private activeSubscriptions: Map<string, AbortController> = new Map();

  constructor(agentRegistry: AgentRegistry, agentTaskService: AgentTaskService, eventEmitter: EventEmitter) {
    this.agentRegistry = agentRegistry;
    this.agentTaskService = agentTaskService;
    this.eventEmitter = eventEmitter;
  }

  public async subscribeToAgentTaskUpdates(agentId: string): Promise<void> {
      const agent = this.agentRegistry.findAgent(agentId);
      if (!agent || !agent.capabilities?.endpoints?.tasks_send_subscribe) {
          console.warn(`[subscribeToAgentTaskUpdates] Agent ${agentId} not found or does not support subscriptions.`);
          return;
      }

      if (this.activeSubscriptions.has(agentId)) {
          console.log(`[subscribeToAgentTaskUpdates] Already subscribed to agent ${agentId}.`);
          return;
      }

      const subscribeEndpoint = `${agent.url}${agent.capabilities.endpoints.tasks_send_subscribe}`;
      console.log(`[subscribeToAgentTaskUpdates] Attempting to subscribe to task updates for agent ${agentId} at ${subscribeEndpoint}`);

      const controller = new AbortController();
      const signal = controller.signal;
      this.activeSubscriptions.set(agentId, controller);

      try {
          const response = await fetch(subscribeEndpoint, { signal });

          if (!response.ok) {
              throw new Error(`HTTP error! status: ${response.status}`);
          }

          if (!response.body) {
              throw new Error('Response body is null');
          }

          const reader = response.body
              .pipeThrough(new TextDecoderStream())
              .getReader();

          let buffer = '';
          while (true) {
              const { value, done } = await reader.read();
              if (done) {
                  console.log(`[subscribeToAgentTaskUpdates] Stream closed for agent ${agentId}.`);
                  break;
              }

              buffer += value;
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                  if (!line.trim()) continue;

                  try {
                      const event = JSON.parse(line);
                      console.log(`[subscribeToAgentTaskUpdates] Received event for agent ${agentId}:`, event);

                      if (event.id && (event.status || event.artifact)) {
                          const taskId = event.id;
                          console.log(`[subscribeToAgentTaskUpdates] Received update for task ${taskId}. Fetching full details...`);
                          const updatedTask = await this.agentTaskService.getAgentTaskDetails(agentId, taskId);

                          if (updatedTask) {
                              const topic = `TASK_UPDATE_${agentId}_${taskId}`;
                              this.eventEmitter.emit(topic, updatedTask);

                              const allTasksTopic = `TASK_UPDATE_${agentId}_ALL`;
                              this.eventEmitter.emit(allTasksTopic, updatedTask);
                          } else {
                              console.warn(`[subscribeToAgentTaskUpdates] Failed to fetch updated task details for task ${taskId} on agent ${agentId}.`);
                          }
                      } else {
                          console.warn(`[subscribeToAgentTaskUpdates] Received unrecognized event format from agent ${agentId}:`, event);
                      }

                  } catch (parseError: any) {
                      console.error(`[subscribeToAgentTaskUpdates] Error parsing stream data for agent ${agentId}: ${parseError.message}`, line);
                  }
              }
          }
      } catch (error: any) {
          if (signal.aborted) {
              console.log(`[subscribeToAgentTaskUpdates] Subscription for agent ${agentId} aborted.`);
          } else {
              console.error(`[subscribeToAgentTaskUpdates] Subscription error for agent ${agentId}: ${error.message}`);
          }
      } finally {
          this.activeSubscriptions.delete(agentId);
          console.log(`[subscribeToAgentTaskUpdates] Cleaned up subscription for agent ${agentId}.`);
      }
  }

  public stopAgentTaskSubscription(agentId: string): void {
      const controller = this.activeSubscriptions.get(agentId);
      if (controller) {
          console.log(`[stopAgentTaskSubscription] Aborting subscription for agent ${agentId}.`);
          controller.abort();
      } else {
          console.log(`[stopAgentTaskSubscription] No active subscription found for agent ${agentId}.`);
      }
  }
}
