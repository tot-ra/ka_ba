import { EventEmitter } from 'node:events';
import { LogEntryPayload } from '../graphql/resolvers.js'; // Assuming this path is correct

export class LogManager {
  private eventEmitter: EventEmitter;
  private agentLogs: Map<string, string[]> = new Map(); // Store historical logs per agent
  private maxLogLines = 100;

  constructor(eventEmitter: EventEmitter) {
    this.eventEmitter = eventEmitter;
  }

  public addLog(agentId: string, message: string, stream: 'stdout' | 'stderr'): void {
    const timestamp = new Date().toISOString();
    const line = message.trim();

    // Store historical log
    const logEntryForStorage = `[${timestamp}] [${stream}] ${line}`;
    if (!this.agentLogs.has(agentId)) {
        this.agentLogs.set(agentId, []);
    }
    const logs = this.agentLogs.get(agentId)!;
    logs.push(logEntryForStorage);
    if (logs.length > this.maxLogLines) {
      logs.shift(); // Remove the oldest log line
    }

    // Publish real-time log entry via PubSub
    const payload: LogEntryPayload = {
      timestamp,
      stream,
      line,
    };
    const topic = `AGENT_LOG_${agentId}`;
    this.eventEmitter.emit(topic, payload);
  }

  public getAgentLogs(agentId: string): string[] | null {
    return this.agentLogs.get(agentId) || null;
  }

  public removeAgentLogs(agentId: string): void {
      this.agentLogs.delete(agentId);
  }
}
