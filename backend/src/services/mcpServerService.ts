import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

interface McpServerConfig {
  name: string;
  timeout: number;
  command: string;
  args: string[];
  transportType: string;
  env: { [key: string]: string };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Adjust the path to point to the config directory relative to the service file
const mcpServersFilePath = path.join(__dirname, '../../../src/config/mcp_servers.json');

export const readMcpServers = async (): Promise<McpServerConfig[]> => {
  try {
    const data = await fs.readFile(mcpServersFilePath, 'utf8');
    return JSON.parse(data) as McpServerConfig[];
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      // File not found, return empty array
      return [];
    }
    throw error;
  }
};

export const writeMcpServers = async (servers: McpServerConfig[]): Promise<void> => {
  await fs.writeFile(mcpServersFilePath, JSON.stringify(servers, null, 2), 'utf8');
};
