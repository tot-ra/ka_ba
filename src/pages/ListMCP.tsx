import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import styles from './ListMCP.module.css'; // Import the CSS module
import { sendGraphQLRequest } from '../utils/graphqlClient'; // Import the sendGraphQLRequest utility
import Button from '../components/Button'; // Import the Button component

interface McpServerConfig {
  name: string;
  timeout: number;
  command: string;
  args: string[];
  transportType: string;
  env: { [key: string]: string };
}

// Define the GraphQL query
const GET_MCP_SERVERS_QUERY = `
  query GetMcpServers {
    mcpServers {
      name
      timeout
      command
      args
      transportType
      env
    }
  }
`;

function ListMCP() {
  const navigate = useNavigate(); // Initialize useNavigate
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchServers = async () => {
    try {
      const response = await sendGraphQLRequest(GET_MCP_SERVERS_QUERY);

      if (response.errors) {
        // Handle GraphQL errors
        console.error('GraphQL errors:', response.errors);
        setError('Failed to fetch MCP servers: ' + response.errors.map(err => err.message).join(', '));
      } else if (response.data?.mcpServers) {
        console.log('MCP servers fetched successfully:', response.data.mcpServers);
        setServers(response.data.mcpServers);
      } else {
        // Handle unexpected response structure
        console.error('Unexpected GraphQL response:', response);
        setError('Failed to fetch MCP servers: Unexpected response from server.');
      }

    } catch (error: any) {
      setError('Failed to fetch MCP servers: ' + error.message);
      console.error('Error fetching MCP servers:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteServer = async (name: string) => {
    if (window.confirm(`Are you sure you want to delete the MCP server "${name}"?`)) {
      try {
        const response = await sendGraphQLRequest(DELETE_MCP_SERVER_MUTATION, { name });

        if (response.errors) {
          console.error('GraphQL errors:', response.errors);
          setError('Failed to delete MCP server: ' + response.errors.map(err => err.message).join(', '));
        } else if (response.data?.deleteMcpServer) {
          console.log(`MCP server "${name}" deleted successfully.`);
          // Refetch the server list after successful deletion
          fetchServers();
        } else {
          console.error('Unexpected GraphQL response after deletion:', response);
          setError('Failed to delete MCP server: Unexpected response from server.');
        }
      } catch (error: any) {
        setError('Failed to delete MCP server: ' + error.message);
        console.error(`Error deleting MCP server "${name}":`, error);
      }
    }
  };

  useEffect(() => {
    fetchServers();
  }, []);

  if (loading) {
    return <div>Loading...</div>;
  }

  if (error) {
    return <div style={{ color: 'red' }}>Error: {error}</div>;
  }

  return (
    <div className={styles.container}>
      <h2>MCP Servers</h2>

      <Link to="/mcp/add" className={styles.addLink}>Add New MCP Server</Link>

      {servers.length === 0 ? (
        <p>No MCP servers added yet.</p>
      ) : (
        <table className={styles.serverList}>
          <tr>
            <th>Name</th>
            <th>Timeout</th>
            <th>Command</th>
            <th>Args</th>
            <th>Transport Type</th>
            <th>Environment Variables</th>
            <th>Actions</th> {/* Add Actions column */}
          </tr>
          {servers.map((server, index) => (
            <tr key={index} className={styles.serverItem}>
              <td>{server.name}</td>
              <td>{server.timeout}s</td>
              <td>{server.command}</td>
              <td>{server.args.join(', ')}</td>
              <td>{server.transportType}</td>
              <td>{JSON.stringify(server.env, null, 2)}</td>
              <td> {/* Actions column */}
                {/* Add Edit Button */}
                <Button onClick={() => navigate(`/mcp/edit/${server.name}`)}>Edit</Button>
                {/* Add Delete Button */}
                <Button variant="danger" onClick={() => handleDeleteServer(server.name)}>Delete</Button>
              </td>
            </tr>
          ))}
        </table>
      )}
    </div>
  );
}

// Define the GraphQL mutation for deleting an MCP server
const DELETE_MCP_SERVER_MUTATION = `
  mutation DeleteMcpServer($name: String!) {
    deleteMcpServer(name: $name)
  }
`;

export default ListMCP;
