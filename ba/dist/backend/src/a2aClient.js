"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.A2AClient = void 0;
const axios_1 = __importDefault(require("axios"));
class A2AClient {
    constructor(agentUrl) {
        this.agentUrl = agentUrl;
    }
    async sendRequest(method, params) {
        const request = {
            jsonrpc: '2.0',
            id: Date.now(), // Simple unique ID
            method,
            params,
        };
        try {
            const response = await axios_1.default.post(this.agentUrl, request);
            return response.data;
        }
        catch (error) {
            console.error(`Error sending JSON-RPC request to ${this.agentUrl}:`, error);
            // Return a structured error response
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -32603, // Internal error
                    message: `Failed to connect to agent at ${this.agentUrl}`,
                    data: error.message,
                },
            };
        }
    }
    async sendTask(params) {
        const response = await this.sendRequest('tasks/send', params);
        if (response.error) {
            console.error('Error in sendTask response:', response.error);
            return null;
        }
        return response.result;
    }
    async sendTaskSubscribe(params) {
        const request = {
            jsonrpc: '2.0',
            id: Date.now(), // Simple unique ID
            method: 'tasks/sendSubscribe',
            params,
        };
        try {
            const response = await axios_1.default.post(this.agentUrl, request, {
                responseType: 'stream',
            });
            return response;
        }
        catch (error) {
            console.error(`Error sending JSON-RPC streaming request to ${this.agentUrl}:`, error);
            // Return a structured error response
            if (axios_1.default.isAxiosError(error) && error.response) {
                // If it's an Axios error with a response, return that response data if available
                return error.response.data; // Assuming agent returns JSONRPC error on non-200
            }
            return {
                jsonrpc: '2.0',
                id: request.id,
                error: {
                    code: -32603, // Internal error
                    message: `Failed to connect to agent at ${this.agentUrl} for streaming`,
                    data: error.message,
                },
            };
        }
    }
    async inputTask(params) {
        const response = await this.sendRequest('tasks/input', params);
        if (response.error) {
            console.error('Error in inputTask response:', response.error);
            return null;
        }
        return response.result;
    }
    async getTaskStatus(params) {
        const response = await this.sendRequest('tasks/status', params);
        if (response.error) {
            console.error('Error in getTaskStatus response:', response.error);
            return null;
        }
        return response.result;
    }
    async getTaskArtifact(params) {
        const response = await this.sendRequest('tasks/artifact', params);
        if (response.error) {
            console.error('Error in getTaskArtifact response:', response.error);
            return null;
        }
        return response.result;
    }
}
exports.A2AClient = A2AClient;
