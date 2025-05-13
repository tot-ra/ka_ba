import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Button from '../components/Button'; // Import the Button component
import styles from './AddMcpServer.module.css'; // Import the CSS module
import { sendGraphQLRequest } from '../utils/graphqlClient'; // Import the sendGraphQLRequest utility

interface McpServerConfig {
  name: string;
  timeout: number;
  command: string;
  args: string[];
  transportType: string;
  env: { [key: string]: string };
}

// Define the GraphQL mutation
const ADD_MCP_SERVER_MUTATION = `
  mutation AddMcpServer($server: InputMcpServerConfig!) {
    addMcpServer(server: $server) {
      name
      timeout
      command
      args
      transportType
      env
    }
  }
`;

function AddMcpServer() {
  const navigate = useNavigate();
  const [newServer, setNewServer] = useState<McpServerConfig>({
    name: '',
    timeout: 60,
    command: 'npx',
    args: [],
    transportType: 'stdio',
    env: {},
  });
  const [error, setError] = useState<string | null>(null);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNewServer({ ...newServer, [name]: value });
  };

  const handleArgsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNewServer({ ...newServer, args: e.target.value.split(',').map(arg => arg.trim()) });
  };

  const handleEnvChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    try {
      const envObject = JSON.parse(e.target.value);
      setNewServer({ ...newServer, env: envObject });
    } catch (error) {
      console.error('Invalid JSON for environment variables:', error);
      // Optionally set an error state for the form field
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null); // Clear previous errors

    try {
      const response = await sendGraphQLRequest(
        ADD_MCP_SERVER_MUTATION,
        { server: newServer }
      );

      if (response.errors) {
        // Handle GraphQL errors
        console.error('GraphQL errors:', response.errors);
        setError('Failed to add MCP server: ' + response.errors.map(err => err.message).join(', '));
      } else if (response.data?.addMcpServer) {
        console.log('MCP server added successfully:', response.data.addMcpServer);
        // Navigate back to the list view after successful addition
        navigate('/mcp');
      } else {
        // Handle unexpected response structure
        console.error('Unexpected GraphQL response:', response);
        setError('Failed to add MCP server: Unexpected response from server.');
      }

    } catch (error: any) { // Explicitly type error as any
      setError('Failed to add MCP server: ' + error.message);
      console.error('Error adding MCP server:', error);
    }
  };

  return (
    <div className={styles.container}>
      <h2>Add New MCP Server</h2>

      {error && <div style={{ color: 'red', marginBottom: '20px' }}>Error: {error}</div>}

      <form onSubmit={handleSubmit} className={styles.form}>
        <label htmlFor="name">Name:</label>
        <input type="text" id="name" name="name" value={newServer.name} onChange={handleInputChange} placeholder="my-mcp-server" required />

        <label htmlFor="timeout">Timeout (s):</label>
        <input type="number" id="timeout" name="timeout" value={newServer.timeout} onChange={handleInputChange} placeholder="60" required />

        <label htmlFor="command">Command:</label>
        <input type="text" id="command" name="command" value={newServer.command} onChange={handleInputChange} placeholder="npx" required />

        <label htmlFor="args">Args (comma-separated):</label>
        <input type="text" id="args" name="args" value={newServer.args.join(', ')} onChange={handleArgsChange} placeholder="-y, @my-mcp/server" />

        <label>Transport Type:</label>
        <div>
          <label>
            <input
              type="radio"
              name="transportType"
              value="stdio"
              checked={newServer.transportType === 'stdio'}
              onChange={handleInputChange}
              required
            />{' '}
            stdio
          </label>
          <label style={{ marginLeft: '15px' }}>
            <input
              type="radio"
              name="transportType"
              value="sse"
              checked={newServer.transportType === 'sse'}
              onChange={handleInputChange}
              required
            />{' '}
            sse
          </label>
        </div>

        <label htmlFor="env">Environment Variables (JSON):</label>
        <textarea id="env" name="env" value={JSON.stringify(newServer.env, null, 2)} onChange={handleEnvChange} rows={5} placeholder='{"API_KEY": "your_key"}'></textarea>

        <div className={styles.buttonContainer}>
          <Button type="submit">Add Server</Button>
        </div>
      </form>
    </div>
  );
}

export default AddMcpServer;
