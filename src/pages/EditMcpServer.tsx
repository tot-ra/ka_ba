import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import styles from './AddMcpServer.module.css'; // Can reuse some styles from AddMcpServer
import { sendGraphQLRequest } from '../utils/graphqlClient';
import Button from '../components/Button'; // Import the Button component

// Define the structure for ToolDefinition to match the schema
interface ToolDefinition {
  name: string;
  description: string;
}

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

// Define the GraphQL query to fetch a single MCP server by name (assuming this exists or will be added)
// NOTE: The current schema doesn't have a query for a single MCP server by name.
// I will proceed assuming we can reuse the mcpServers query and filter on the client side for now,
// but a dedicated query would be more efficient.
const GET_MCP_SERVERS_QUERY = `
  query GetMcpServers {
    mcpServers {
      name
      timeout
      command
      args
      transportType
      env
      tools { # Request tools
        name
        description
      }
      resources # Request resources
    }
  }
`;

// Define the GraphQL mutation for editing an MCP server
const EDIT_MCP_SERVER_MUTATION = `
  mutation EditMcpServer($name: String!, $server: InputMcpServerConfig!) {
    editMcpServer(name: $name, server: $server) {
      name
      timeout
      command
      args
      transportType
      env
      tools { # Request tools in the response
        name
        description
      }
      resources # Request resources in the response
    }
  }
`;

function EditMcpServer() {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [serverConfig, setServerConfig] = useState<McpServerConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState<McpServerConfig>({
    name: '',
    timeout: 60,
    command: '',
    args: [],
    transportType: 'stdio', // Default
    env: {},
    tools: [], // Add initial empty array for tools
    resources: [], // Add initial empty array for resources
  });

  const [rawArgsInput, setRawArgsInput] = useState(''); // New state for raw args input

  useEffect(() => {
    const fetchServer = async () => {
      try {
        const response = await sendGraphQLRequest(GET_MCP_SERVERS_QUERY);

        if (response.errors) {
          console.error('GraphQL errors:', response.errors);
          setError('Failed to fetch MCP server: ' + response.errors.map(err => err.message).join(', '));
        } else if (response.data?.mcpServers) {
          const server = response.data.mcpServers.find((s: McpServerConfig) => s.name === name);
          if (server) {
            setServerConfig(server);
            setFormData(server); // Initialize form data with fetched server config
            setRawArgsInput(server.args.join(', ')); // Initialize raw args input
            console.log('MCP server fetched successfully:', server);
          } else {
            setError(`MCP server with name "${name}" not found.`);
            console.error(`MCP server with name "${name}" not found.`);
          }
        } else {
          console.error('Unexpected GraphQL response:', response);
          setError('Failed to fetch MCP server: Unexpected response from server.');
        }
      } catch (error: any) {
        setError('Failed to fetch MCP server: ' + error.message);
        console.error('Error fetching MCP server:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchServer();
  }, [name]); // Refetch if name changes

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData({ ...formData, [name]: value });
  };

  const handleRawArgsInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('Raw args input:', e.target.value);
    setRawArgsInput(e.target.value);
  };

  const handleEnvChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    try {
      setFormData({ ...formData, env: JSON.parse(e.target.value) });
    } catch (err) {
      console.error('Invalid JSON for environment variables:', err);
      // Optionally set an env error state
    }
  };

  const handleTransportTypeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({ ...formData, transportType: e.target.value });
  };


  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      // Create a new object with only the fields allowed by InputMcpServerConfig
      const inputServerConfig = {
        name: formData.name,
        timeout: formData.timeout,
        command: formData.command,
        args: rawArgsInput.split(',').map(arg => arg.trim()), // Parse args from raw input on submit
        transportType: formData.transportType,
        env: formData.env,
        // Exclude tools and resources as they are not part of InputMcpServerConfig
      };

      const response = await sendGraphQLRequest(EDIT_MCP_SERVER_MUTATION, {
        name: name, // Use the name from the URL for the mutation
        server: inputServerConfig, // Send the filtered data
      });

      if (response.errors) {
        console.error('GraphQL errors:', response.errors);
        setError('Failed to edit MCP server: ' + response.errors.map(err => err.message).join(', '));
      } else if (response.data?.editMcpServer) {
        console.log('MCP server edited successfully:', response.data.editMcpServer);
        navigate('/mcp'); // Navigate back to the list page
      } else {
        console.error('Unexpected GraphQL response after editing:', response);
        setError('Failed to edit MCP server: Unexpected response from server.');
      }
    } catch (error: any) {
      setError('Failed to edit MCP server: ' + error.message);
      console.error('Error editing MCP server:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div style={{ color: 'red' }}>Error: {error}</div>;
  }

  if (!serverConfig) {
      return <div>Server not found.</div>;
  }


  return (
    <div className={styles.container}>
      <h2>Edit MCP Server: {serverConfig.name}</h2>
      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.formGroup}>
          <label htmlFor="name">Name:</label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleInputChange}
            required
            disabled // Name should not be editable after creation
          />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="timeout">Timeout (seconds):</label>
          <input
            type="number"
            id="timeout"
            name="timeout"
            value={formData.timeout}
            onChange={handleInputChange}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="command">Command:</label>
          <input
            type="text"
            id="command"
            name="command"
            value={formData.command}
            onChange={handleInputChange}
            required
          />
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="args">Arguments (comma-separated):</label>
          <input
            type="text"
            id="args"
            name="args"
            value={rawArgsInput} // Use rawArgsInput for the input value
            onChange={handleRawArgsInputChange} // Update rawArgsInput on change
          />
        </div>
         <div className={styles.formGroup}>
          <label>Transport Type:</label>
          <div>
            <label>
              <input
                type="radio"
                name="transportType"
                value="stdio"
                checked={formData.transportType === 'stdio'}
                onChange={handleTransportTypeChange}
              />
              stdio
            </label>
            {/* Add other transport types as needed */}
          </div>
        </div>
        <div className={styles.formGroup}>
          <label htmlFor="env">Environment Variables (JSON):</label>
          <textarea
            id="env"
            name="env"
            value={JSON.stringify(formData.env, null, 2)}
            onChange={handleEnvChange}
            rows={5}
          ></textarea>
        </div>
        <Button type="submit" disabled={loading}>
          {loading ? 'Saving...' : 'Save Changes'}
        </Button>
        {error && <div style={{ color: 'red' }}>{error}</div>}
      </form>

      {/* Display Tools */}
      {serverConfig.tools && serverConfig.tools.length > 0 && (
        <div className={styles.formGroup}> {/* Reuse formGroup style for spacing */}
          <h3>Available Tools:</h3>
          <ul>
            {serverConfig.tools.map((tool, index) => (
              <li key={index}>
                <strong>{tool.name}:</strong> {tool.description}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Display Resources */}
      {serverConfig.resources && serverConfig.resources.length > 0 && (
        <div className={styles.formGroup}> {/* Reuse formGroup style for spacing */}
          <h3>Available Resources:</h3>
          <ul>
            {serverConfig.resources.map((resource, index) => (
              <li key={index}>{resource}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default EditMcpServer;
