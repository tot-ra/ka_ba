import { GraphQLError } from 'graphql';
import { ApolloContext } from './server.js';
import { readMcpServers, writeMcpServers, fetchMcpServerCapabilities } from '../services/mcpServerService.js'; // Import MCP server service functions and fetchCapabilities

// Define the payload structure for the agentLogs subscription
export interface LogEntryPayload {
  timestamp: string; // ISO timestamp string
  stream: 'stdout' | 'stderr';
  line: string;
}

// Define the structure for ToolDefinition to match the schema
interface ToolDefinition {
  name: string;
  description: string;
}

// Define the structure for McpServerConfig to match the schema
interface McpServerConfig {
  name: string;
  timeout: number;
  command: string;
  args: string[];
  transportType: string;
  env: { [key: string]: string };
  tools: ToolDefinition[]; // Add tools field
  resources: string[]; // Add resources field
}

// Define interface for addMcpServer mutation arguments
interface AddMcpServerArgs {
  server: McpServerConfig;
}

export const mcpServersResolvers = {
    Query:{
              mcpServers: async (_parent: any, _args: any, _context: ApolloContext, _info: any): Promise<McpServerConfig[]> => {
                try {
                  const servers = await readMcpServers();
                  return servers;
                } catch (error: any) {
                  console.error('Error adding MCP server:', error);
                  throw new GraphQLError('Failed to add MCP server', {
                    extensions: { code: 'INTERNAL_SERVER_ERROR' },
                    originalError: error,
                  });
                }
              },
    },
    Mutation: {

              addMcpServer: async (_parent: any, { server }: AddMcpServerArgs, _context: ApolloContext, _info: any): Promise<McpServerConfig> => {
                try {
                  // Fetch capabilities before saving
                  const capabilities = await fetchMcpServerCapabilities(server);
                  const serverWithCapabilities = { ...server, ...capabilities }; // Merge capabilities into server object
        
                  const servers = await readMcpServers();
                  servers.push(serverWithCapabilities); // Push server with capabilities
                  await writeMcpServers(servers);
                  return serverWithCapabilities; // Return server with capabilities
                }
                catch (error: any) {
                  console.error('Error adding MCP server:', error);
                  throw new GraphQLError('Failed to add MCP server', {
                    extensions: { code: 'INTERNAL_SERVER_ERROR' },
                    originalError: error,
                  });
                }
              },
        
              // Resolver to edit an existing MCP server
              editMcpServer: async (_parent: any, { name, server }: { name: string, server: McpServerConfig }, _context: ApolloContext, _info: any): Promise<McpServerConfig> => {
                try {
                  const servers = await readMcpServers();
                  const serverIndex = servers.findIndex(s => s.name === name);
                  if (serverIndex === -1) {
                    throw new GraphQLError(`MCP server with name "${name}" not found.`, {
                      extensions: { code: 'NOT_FOUND' },
                    });
                  }
        
                  // Fetch capabilities for the updated server config
                  const capabilities = await fetchMcpServerCapabilities(server);
                  const serverWithCapabilities = { ...server, ...capabilities }; // Merge capabilities into server object
        
                  servers[serverIndex] = serverWithCapabilities; // Replace with server with capabilities
                  await writeMcpServers(servers);
                  return serverWithCapabilities; // Return server with capabilities
                } catch (error: any) {
                  console.error(`Error editing MCP server "${name}":`, error);
                  throw new GraphQLError(`Failed to edit MCP server "${name}"`, {
                    extensions: { code: 'INTERNAL_SERVER_ERROR' },
                    originalError: error,
                  });
                }
              },
        
              // Resolver to delete an MCP server
              deleteMcpServer: async (_parent: any, { name }: { name: string }, _context: ApolloContext, _info: any): Promise<boolean> => {
                try {
                  const servers = await readMcpServers();
                  const initialLength = servers.length;
                  const updatedServers = servers.filter(s => s.name !== name);
                  if (updatedServers.length === initialLength) {
                     throw new GraphQLError(`MCP server with name "${name}" not found.`, {
                       extensions: { code: 'NOT_FOUND' },
                     });
                  }
                  await writeMcpServers(updatedServers);
                  return true;
                } catch (error: any) {
                  console.error(`Error deleting MCP server "${name}":`, error);
                  throw new GraphQLError(`Failed to delete MCP server "${name}"`, {
                    extensions: { code: 'INTERNAL_SERVER_ERROR' },
                    originalError: error,
                  });
                }
              },
    }
}