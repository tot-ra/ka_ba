import axios, { AxiosResponse } from 'axios';
import { Readable } from 'stream';

interface JSONRPCRequest {
  jsonrpc: string;
  id?: number | string | null;
  method: string;
  params?: any;
}

interface JSONRPCResponse {
  jsonrpc: string;
  id?: number | string | null;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

interface TextPart {
  type: 'text';
  text: string;
  metadata?: any;
}

interface FileContent {
  name?: string | null;
  mimeType?: string | null;
  bytes?: string | null; // base64 encoded
  uri?: string | null;
}

interface FilePart {
  type: 'file';
  file: FileContent;
  metadata?: any;
}

interface DataPart {
  type: 'data';
  data: any; // JSON object
  metadata?: any;
}

export type Part = TextPart | FilePart | DataPart; // Export Part

export interface Message { // Export Message
  role: 'user' | 'agent';
  parts: Part[];
  metadata?: any;
}

export interface TaskStatus { // Export TaskStatus
  state: 'submitted' | 'working' | 'input-required' | 'completed' | 'canceled' | 'failed' | 'unknown';
  message?: Message | null;
  timestamp: string; // date-time format
}

interface Artifact {
  name?: string | null;
  description?: string | null;
  parts: Part[];
  index: number;
  append?: boolean | null;
  lastChunk?: boolean | null;
  metadata?: any;
}

export interface Task { // Export Task
  id: string;
  sessionId?: string | null;
  status: TaskStatus;
  artifacts?: Artifact[] | null;
  history?: Message[] | null;
  metadata?: any;
}

interface TaskStatusUpdateEvent {
  id: string;
  status: TaskStatus;
  final?: boolean;
  metadata?: any;
}

interface TaskArtifactUpdateEvent {
  id: string;
  artifact: Artifact;
  metadata?: any;
}

type StreamingTaskResult = TaskStatusUpdateEvent | TaskArtifactUpdateEvent;

interface JSONRPCStreamingResponse {
  jsonrpc: string;
  id?: number | string | null;
  result?: StreamingTaskResult | null;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}


export interface TaskSendParams { // Export TaskSendParams
  // Note: The 'id' field here seems incorrect for *sending* a new task,
  // as the agent usually generates the ID. The agent's /tasks/send
  // endpoint likely expects the message and other params, not a pre-defined ID.
  // Adjusting the client or the usage might be needed later.
  id?: string; // Making ID optional for now, assuming agent generates it if missing.
  sessionId?: string;
  message: Message;
  pushNotification?: any; // TODO: Define PushNotificationConfig interface
  historyLength?: number;
  metadata?: any;
}

interface TaskInputParams {
  id: string; // Task ID
  message: Message; // Input message
  metadata?: any;
}

interface TaskInputParams {
  id: string; // Task ID
  message: Message; // Input message
  metadata?: any;
}

interface TaskStatusParams {
  id: string; // Task ID
  metadata?: any;
}


export class A2AClient {
  private agentUrl: string;

  constructor(agentUrl: string) {
    this.agentUrl = agentUrl;
  }

  private async sendRequest(method: string, params?: any): Promise<JSONRPCResponse> {
    const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: Date.now(), // Simple unique ID
      method,
      params,
    };

    try {
      const response = await axios.post(this.agentUrl, request);
      return response.data;
    } catch (error) {
      console.error(`Error sending JSON-RPC request to ${this.agentUrl}:`, error);
      // Return a structured error response
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603, // Internal error
          message: `Failed to connect to agent at ${this.agentUrl}`,
          data: (error as Error).message,
        },
      };
    }
  }

  async sendTask(params: TaskSendParams): Promise<Task | null> {
    const response = await this.sendRequest('tasks/send', params);
    if (response.error) {
      console.error('Error in sendTask response:', response.error);
      return null;
    }
    return response.result as Task;
  }

  async sendTaskSubscribe(params: TaskSendParams): Promise<AxiosResponse<Readable> | JSONRPCResponse> {
     const request: JSONRPCRequest = {
      jsonrpc: '2.0',
      id: Date.now(), // Simple unique ID
      method: 'tasks/sendSubscribe',
      params,
    };

    try {
      const response = await axios.post<Readable>(this.agentUrl, request, {
        responseType: 'stream',
      });
      return response;
    } catch (error) {
      console.error(`Error sending JSON-RPC streaming request to ${this.agentUrl}:`, error);
      // Return a structured error response
      if (axios.isAxiosError(error) && error.response) {
         // If it's an Axios error with a response, return that response data if available
         return error.response.data as JSONRPCResponse; // Assuming agent returns JSONRPC error on non-200
      }
       return {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603, // Internal error
          message: `Failed to connect to agent at ${this.agentUrl} for streaming`,
          data: (error as Error).message,
        },
      };
    }
  }

  async inputTask(params: TaskInputParams): Promise<Task | null> {
    const response = await this.sendRequest('tasks/input', params);
     if (response.error) {
      console.error('Error in inputTask response:', response.error);
      return null;
    }
    return response.result as Task;
  }

  async getTaskStatus(params: TaskStatusParams): Promise<Task | null> {
    const response = await this.sendRequest('tasks/status', params);
    if (response.error) {
      console.error('Error in getTaskStatus response:', response.error);
      return null;
    }
    return response.result as Task;
  }


  async getTaskArtifact(params: TaskStatusParams): Promise<Artifact[] | null> { // Assuming artifact endpoint returns an array of Artifacts
    const response = await this.sendRequest('tasks/artifact', params);
    if (response.error) {
      console.error('Error in getTaskArtifact response:', response.error);
      return null;
    }
    return response.result as Artifact[];
  }

  // Method to list all tasks from the agent using JSON-RPC
  async listTasks(): Promise<Task[] | null> {
    console.log(`[A2AClient] Sending JSON-RPC request for 'tasks/list' to ${this.agentUrl}`);
    // Use the sendRequest helper to make a JSON-RPC call
    const response = await this.sendRequest('tasks/list'); // No parameters needed for list

    if (response.error) {
      console.error(`[A2AClient] Error in listTasks response:`, response.error);
      return null; // Return null on error
    }

    // Assuming the result is directly the array of tasks
    // Add validation if necessary
    if (Array.isArray(response.result)) {
      return response.result as Task[];
    } else {
      console.error(`[A2AClient] Invalid result format for listTasks: Expected array, got`, response.result);
      return null;
    }
  }
}
