import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, ChildProcess } from 'child_process'; // Import spawn and ChildProcess
import axios from 'axios'; // Import axios for HTTP calls

// Define the structure for ToolDefinition to match the schema
interface ToolDefinition {
  name: string;
  description: string;
  // Add input schema later if needed
}

interface McpServerConfig {
  name: string;
  timeout: number;
  command: string;
  args: string[];
  transportType: string;
  env: { [key: string]: string };
  tools: ToolDefinition[]; // Add tools field
  resources: string[]; // Add resources field (using string URIs for now)
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

// Function to fetch capabilities from an MCP server
export const fetchMcpServerCapabilities = async (serverConfig: McpServerConfig): Promise<{ tools: ToolDefinition[], resources: string[] }> => {
  console.log(`Attempting to fetch capabilities for MCP server: ${serverConfig.name}`);

  let mcpProcess: ChildProcess | undefined;
  let capabilities: { tools: ToolDefinition[], resources: string[] } = { tools: [], resources: [] };
  let serverPort: number | undefined;
  let startupTimeoutId: NodeJS.Timeout | undefined;

  const killProcess = () => {
    if (mcpProcess && !mcpProcess.killed) {
      console.log(`Killing MCP server process ${serverConfig.name} (PID: ${mcpProcess.pid})`);
      mcpProcess.kill();
    }
  };

  try {
    // 1. Spawn the process
    console.log(`Spawning MCP server process: ${serverConfig.command} ${serverConfig.args.join(' ')}`);
    mcpProcess = spawn(serverConfig.command, serverConfig.args, {
      env: { ...process.env, ...serverConfig.env }, // Merge with current process env
      shell: true, // Use shell to allow command execution with paths/aliases
    });

    // Handle process exit
    mcpProcess.on('close', (code) => {
      console.log(`MCP server process ${serverConfig.name} exited with code ${code}`);
      // TODO: Handle unexpected early exit
    });

    mcpProcess.on('error', (err) => {
      console.error(`Failed to start MCP server process ${serverConfig.name}: ${err.message}`);
      // TODO: Handle spawning error
    });

    // Set a timeout for the entire process
    const overallTimeout = serverConfig.timeout * 1000; // Convert seconds to milliseconds
    const timeoutPromise = new Promise<never>((_resolve, reject) => { // Explicitly type as never
      startupTimeoutId = setTimeout(() => {
        reject(new Error(`MCP server ${serverConfig.name} did not start or respond within ${serverConfig.timeout} seconds.`));
      }, overallTimeout);
    });

    // Helper to send JSON-RPC request and wait for response
    const sendRpcRequest = async (method: string, id: number, params?: any): Promise<any> => {
        const request = {
            jsonrpc: "2.0",
            id: id,
            method: method,
            params: params,
        };
        const requestJson = JSON.stringify(request);
        console.log(`Sending JSON-RPC request (ID: ${id}, Method: ${method}): ${requestJson}`);
        mcpProcess?.stdin?.write(requestJson + '\n'); // Assuming newline delimited JSON

        // Wait for the response with matching ID
        return new Promise((resolve, reject) => {
            let responseData = '';
            const onData = (data: Buffer) => {
                responseData += data.toString();
                console.log(`MCP server stdout (accumulating): ${data.toString().trim()}`);

                // Attempt to parse as JSON (assuming newline delimited)
                const messages = responseData.split('\n').filter(line => line.trim() !== '');
                for (const message of messages) {
                    try {
                        const parsed = JSON.parse(message);
                        if (parsed.jsonrpc === "2.0" && parsed.id === id) {
                            console.log(`Received JSON-RPC response for ID ${id}:`, parsed);
                            mcpProcess?.stdout?.off('data', onData); // Stop listening for this response
                            // Remove the processed message from the buffer
                            responseData = responseData.replace(message + '\n', '');
                            resolve(parsed);
                            return; // Exit the loop and listener
                        }
                    } catch (e) {
                        // Not a complete JSON message yet, continue accumulating
                    }
                }
            };
            mcpProcess?.stdout?.on('data', onData);

            // Handle process exit before response
            mcpProcess?.on('close', (code) => {
                 reject(new Error(`MCP server process exited with code ${code} before receiving response for ID ${id}.`));
            });

            mcpProcess?.on('error', (err) => {
               reject(new Error(`Failed to start MCP server process for RPC: ${err.message}`));
            });
        });
    };


    // 2. Handle capability fetching based on transport type
    if (serverConfig.transportType === 'http') {
        // Existing HTTP logic (wait for port, readiness check, fetch capabilities)
        // Capture stdout to find the port
        let stdoutData = '';
        const portPromise = new Promise<number>((resolve, reject) => {
          const onData = (data: Buffer) => {
            stdoutData += data.toString();
            console.log(`MCP server stdout: ${data.toString().trim()}`);
            // Attempt to find the port in the stdout (assuming it prints "Listening on port XXXX")
            const portMatch = stdoutData.match(/port\s+(\d+)/i);
            if (portMatch && portMatch[1]) {
              serverPort = parseInt(portMatch[1], 10);
              console.log(`Detected MCP server port: ${serverPort}`);
              mcpProcess?.stdout?.off('data', onData); // Stop listening once port is found
              resolve(serverPort);
            }
          };
          mcpProcess?.stdout?.on('data', onData);

          // Reject if process exits before port is found
          mcpProcess?.on('close', (code) => {
            if (serverPort === undefined) {
              reject(new Error(`MCP server process exited with code ${code} before port was detected.`));
            }
          });

          mcpProcess?.on('error', (err) => {
             reject(new Error(`Failed to start MCP server process: ${err.message}`));
          });
        });

        // Wait for the port to be detected or timeout
        try {
          const result = await Promise.race([portPromise, timeoutPromise]);
          serverPort = result as number; // Explicitly cast the result to number
          clearTimeout(startupTimeoutId); // Clear the initial timeout
        } catch (error: any) {
          clearTimeout(startupTimeoutId); // Ensure timeout is cleared
          // Check if the error is the timeout error
          if (error.message.includes('did not start or respond within')) {
            console.error(`Startup timeout for MCP server ${serverConfig.name}: ${error.message}`);
            throw new Error(`Startup timeout for MCP server ${serverConfig.name}`);
          }
          // Re-throw other errors
          throw error;
        }


        const serverUrl = `http://localhost:${serverPort}`;
        console.log(`Waiting for MCP server to be ready at ${serverUrl}`);

        const readinessCheck = async (url: string, retries: number, delay: number): Promise<void> => {
          try {
            await axios.get(url, { timeout: 1000 }); // Short timeout for readiness check
            console.log(`MCP server at ${url} is ready.`);
          } catch (error: any) {
            if (retries > 0) {
              console.log(`Readiness check failed for ${url}. Retrying in ${delay}ms... (${retries} retries left)`);
              await new Promise(resolve => setTimeout(resolve, delay));
              await readinessCheck(url, retries - 1, delay);
            } else {
              throw new Error(`MCP server at ${url} did not become ready after multiple retries.`);
            }
          }
        };

        // Wait for the server to be ready with retries
        await readinessCheck(serverUrl, 10, 500); // Retry 10 times with 500ms delay (5 seconds total)


        // 3. Fetch capabilities via HTTP
        try {
          console.log(`Fetching tools from ${serverUrl}/tools`);
          const toolsResponse = await axios.get<ToolDefinition[]>(`${serverUrl}/tools`, { timeout: 5000 }); // Timeout for fetching tools
        } catch (error: any) {
          console.error(`Error fetching tools from ${serverUrl}/tools: ${error.message}`);
          capabilities.tools = []; // Assume no tools on error
        }

        try {
          console.log(`Fetching resources from ${serverUrl}/resources`);
          const resourcesResponse = await axios.get<string[]>(`${serverUrl}/resources`, { timeout: 5000 }); // Timeout for fetching resources
         if (resourcesResponse.status !== 200 || !Array.isArray(resourcesResponse.data)) {
          console.warn(`Unexpected response from /resources endpoint: Status ${resourcesResponse.status}, Data:`, resourcesResponse.data);
          capabilities.resources = []; // Assume no resources if response is invalid
        } else {
          capabilities.resources = resourcesResponse.data;
          console.log(`Fetched ${capabilities.resources.length} resources.`);
        }
      } catch (error: any) {
        console.error(`Error fetching resources from ${serverUrl}/resources: ${error.message}`);
        capabilities.resources = []; // Assume no resources on error
      }

    } else if (serverConfig.transportType === 'stdio') {
        console.log(`Handling stdio transport for ${serverConfig.name}. Initiating JSON-RPC capability discovery.`);

        // Send tools/list request
        try {
            const toolsResponse = await Promise.race([sendRpcRequest("tools/list", 1), timeoutPromise]);
            if (toolsResponse.error) {
                console.error(`Error response for tools/list:`, toolsResponse.error);
                capabilities.tools = [];
            } else if (toolsResponse.result && Array.isArray(toolsResponse.result.tools)) {
                 capabilities.tools = toolsResponse.result.tools;
                 console.log(`Fetched ${capabilities.tools.length} tools via stdio.`);
            } else {
                 console.warn(`Unexpected response format for tools/list:`, toolsResponse);
                 capabilities.tools = [];
            }
        } catch (error: any) {
             console.error(`Error fetching tools via stdio: ${error.message}`);
             capabilities.tools = [];
        }


        // Send resources/list request
        try {
            const resourcesResponse = await Promise.race([sendRpcRequest("resources/list", 2), timeoutPromise]);
             if (resourcesResponse.error) {
                console.error(`Error response for resources/list:`, resourcesResponse.error);
                capabilities.resources = [];
            } else if (resourcesResponse.result && Array.isArray(resourcesResponse.result.resources)) {
                 capabilities.resources = resourcesResponse.result.resources;
                 console.log(`Fetched ${capabilities.resources.length} resources via stdio.`);
            } else {
                 console.warn(`Unexpected response format for resources/list:`, resourcesResponse);
                 capabilities.resources = [];
            }
        } catch (error: any) {
             console.error(`Error fetching resources via stdio: ${error.message}`);
             capabilities.resources = [];
        }


    } else {
         console.warn(`Unsupported transportType "${serverConfig.transportType}" for fetching capabilities.`);
         // Capabilities remain empty for unsupported transport types
    }


  } catch (error: any) {
    console.error(`Error fetching capabilities for ${serverConfig.name}: ${error.message}`);
    // Ensure process is killed on error
    killProcess();
    throw error; // Re-throw the error
  } finally {
    // Ensure process is killed after fetching capabilities or on timeout/error
    killProcess();
  }

  return capabilities;
};
