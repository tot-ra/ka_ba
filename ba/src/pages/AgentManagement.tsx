import React, { useState, useEffect } from 'react';
import axios from 'axios'; // Assuming axios is used for HTTP requests

type Tab = 'manage' | 'add';
type SpawnMessageType = 'success' | 'error' | null;

interface Agent {
  id: string;
  url: string;
  name?: string;
  description?: string;
  isLocal: boolean; // Add isLocal flag
}

const AgentManagement: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [newAgentUrl, setNewAgentUrl] = useState('');
  const [newAgentName, setNewAgentName] = useState(''); // State for new agent name
  const [activeTab, setActiveTab] = useState<Tab>('manage'); // State for active tab
  const [spawnAgentConfig, setSpawnAgentConfig] = useState({
    model: 'qwen3-30b-a3b', // Default model
    systemPrompt: 'You are an expert software engineer.', // Default prompt
    apiBaseUrl: 'http://192.168.1.205:1234', // Default API base URL
    port: '', // Default port
    name: 'Software Engineer', // State for spawned agent name
    description: 'An AI assistant specialized in software engineering tasks.', // State for spawned agent description
  });
  const [showAdvanced, setShowAdvanced] = useState(false); // State for advanced section visibility
  const [isSpawning, setIsSpawning] = useState(false); // State for spawn loading
  const [spawnStatusMessage, setSpawnStatusMessage] = useState<string | null>(null); // State for spawn feedback
  const [spawnMessageType, setSpawnMessageType] = useState<SpawnMessageType>(null); // State for feedback type

  useEffect(() => {
    // Fetch agents from backend on component mount
    const fetchAgents = async () => {
      try {
        // Assuming a GraphQL endpoint at /graphql
        const response = await axios.post('http://localhost:3000/graphql', {
          query: `
            query {
              agents {
                id
                url
                name
                description
                isLocal # Fetch isLocal flag
              }
            }
          `,
        });
        setAgents(response.data.data.agents);
      } catch (error) {
        console.error('Error fetching agents:', error);
      }
    };

    fetchAgents();
  }, []);

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId);
    console.log('Selected agent:', agentId);
    // TODO: Store selected agent in a more persistent state (e.g., context, global state)
  };

  const handleStopAgent = async (agentId: string) => {
    console.log('Attempting to stop agent:', agentId);
    try {
      const response = await axios.post('http://localhost:3000/graphql', {
        query: `
          mutation StopKaAgent($id: ID!) {
            stopKaAgent(id: $id)
          }
        `,
        variables: {
          id: agentId,
        },
      });
      if (response.data.data.stopKaAgent) {
        console.log('Agent stopped successfully:', agentId);
        // Refresh the agent list after stopping
        const updatedAgents = agents.filter(agent => agent.id !== agentId);
        setAgents(updatedAgents);
        // If the stopped agent was selected, deselect it
        if (selectedAgentId === agentId) {
          setSelectedAgentId(null);
        }
      } else {
        console.error('Failed to stop agent:', agentId);
      }
    } catch (error) {
      console.error('Error stopping agent:', error);
    }
  };

  const handleAddAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    console.log('Attempting to add agent:', newAgentUrl, 'with name:', newAgentName);
    try {
      const response = await axios.post('http://localhost:3000/graphql', {
        query: `
          mutation AddAgent($url: String!, $name: String) {
            addAgent(url: $url, name: $name) {
              id
              url
              name
              description
              isLocal # Fetch isLocal flag
            }
          }
        `,
        variables: {
          url: newAgentUrl,
          name: newAgentName || null, // Send null if name is empty
        },
      });
      const newAgent = response.data.data.addAgent;
      if (newAgent && newAgent.id) {
        console.log('Agent added successfully:', newAgent);
        setAgents([...agents, newAgent]);
        setNewAgentUrl(''); // Clear input
        setNewAgentName(''); // Clear name input
      } else {
        console.error('Failed to add agent or received invalid data:', newAgentUrl, newAgentName, newAgent);
      }
    } catch (error) {
      console.error('Error adding agent:', error);
    }
  };

  const handleSpawnAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSpawning(true);
    setSpawnStatusMessage(null);
    setSpawnMessageType(null);
    console.log('Attempting to spawn agent with config:', spawnAgentConfig);

    // Prepare variables, sending null for port if it's empty or 0
    const variables = {
      ...spawnAgentConfig,
      port: spawnAgentConfig.port ? parseInt(spawnAgentConfig.port.toString(), 10) : null, // Send null if port is 0 or empty
      name: spawnAgentConfig.name || null, // Send null if name is empty
      description: spawnAgentConfig.description || null, // Send null if description is empty
    };
    console.log('Variables being sent:', variables);


    try {
      const response = await axios.post('http://localhost:3000/graphql', {
        query: `
          mutation SpawnKaAgent($model: String, $systemPrompt: String, $apiBaseUrl: String, $port: Int, $name: String, $description: String) {
            spawnKaAgent(model: $model, systemPrompt: $systemPrompt, apiBaseUrl: $apiBaseUrl, port: $port, name: $name, description: $description) {
              id
              url
              name
              description
              isLocal # Fetch isLocal flag
            }
          }
        `,
        variables: variables,
      });
      const spawnedAgent = response.data.data.spawnKaAgent;
      if (spawnedAgent && spawnedAgent.id) {
        console.log('Agent spawned successfully:', spawnedAgent);
        setAgents([...agents, spawnedAgent]);
        setSpawnStatusMessage(`Agent "${spawnedAgent.name || spawnedAgent.id}" spawned successfully at ${spawnedAgent.url}.`);
        setSpawnMessageType('success');
        // Clear form, keeping defaults for model, prompt, url but clearing name and resetting port
        setSpawnAgentConfig({
          model: 'qwen3-30b-a3b',
          systemPrompt: 'You are a helpful assistant.',
          apiBaseUrl: 'http://192.168.1.205:1234',
          port: '', // Reset port to default
          name: '', // Clear name
          description: '', // Clear description
        });
      } else {
        // Handle potential GraphQL errors returned in the response body
        const errorMessage = response.data.errors?.[0]?.message || 'Failed to spawn agent or received invalid data.';
        console.error('Failed to spawn agent:', spawnAgentConfig, response.data);
        setSpawnStatusMessage(`Error: ${errorMessage}`);
        setSpawnMessageType('error');
      }
    } catch (error: any) {
      console.error('Error spawning agent:', error);
      const message = error.response?.data?.errors?.[0]?.message || error.message || 'An unknown error occurred.';
      setSpawnStatusMessage(`Error: ${message}`);
      setSpawnMessageType('error');
    } finally {
      setIsSpawning(false);
    }
  };


  const TabButton: React.FC<{ tabId: Tab; currentTab: Tab; onClick: (tabId: Tab) => void; children: React.ReactNode }> = ({ tabId, currentTab, onClick, children }) => (
    <button
      onClick={() => onClick(tabId)}
      style={{
        padding: '10px 15px',
        cursor: 'pointer',
        border: '1px solid #ccc',
        borderBottom: currentTab === tabId ? 'none' : '1px solid #ccc',
        backgroundColor: currentTab === tabId ? 'white' : '#f0f0f0',
        marginRight: '5px',
        borderTopLeftRadius: '4px',
        borderTopRightRadius: '4px',
        fontWeight: currentTab === tabId ? 'bold' : 'normal',
      }}
    >
      {children}
    </button>
  );

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>

      {/* Tab Navigation */}
      <div style={{ marginBottom: '0px', borderBottom: '1px solid #ccc' }}>
        <TabButton tabId="manage" currentTab={activeTab} onClick={setActiveTab}>Manage Agents</TabButton>
        <TabButton tabId="add" currentTab={activeTab} onClick={setActiveTab}>Add External Agent</TabButton>
      </div>

      {/* Tab Content */}
      <div style={{ paddingTop: '20px' }}>
        {/* Manage Agents Tab */}
        {activeTab === 'manage' && (
          <>
            <div style={{ marginBottom: '30px' }}>
              <h2 style={{ marginBottom: '15px' }}>Known Agents</h2>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {agents.map(agent => (
                  <li key={agent.id} style={{
                    border: '1px solid #ddd',
                    padding: '10px',
                    marginBottom: '10px',
                    borderRadius: '4px',
                    backgroundColor: selectedAgentId === agent.id ? '#e9e9e9' : '#f9f9f9',
                    display: 'flex',
                    alignItems: 'left',
                    justifyContent: 'space-between'
                  }}>
                    <div style={{ display: 'flex', textAlign: 'left' }}>
                      <input
                        type="radio"
                        id={`agent-${agent.id}`}
                        name="selectedAgent"
                        value={agent.id}
                        checked={selectedAgentId === agent.id}
                        onChange={() => handleSelectAgent(agent.id)}
                        style={{ marginRight: '10px' }}
                      />
                      <label htmlFor={`agent-${agent.id}`}>
                        <strong><a href={agent.url + '/.well-known/agent.json'} target="_blank">{agent.name || 'Unnamed Agent'}</a></strong>
                        {agent.description && <div style={{ fontSize: '0.9em', color: '#555' }}>{agent.description}</div>}
                      </label>
                    </div>
                    {/* Show stop button only for locally spawned agents */}
                    {agent.isLocal && (
                      <button
                        onClick={() => handleStopAgent(agent.id)}
                        style={{
                          marginLeft: '10px',
                          padding: '5px 10px',
                          backgroundColor: '#dc3545',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                      >
                        Stop
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>

            <div style={{ marginBottom: '30px' }}>
              <h2 style={{ marginBottom: '15px' }}>Spawn Local ka Agent</h2>
              <form onSubmit={handleSpawnAgent} style={{ display: 'grid', gap: '15px', maxWidth: '600px', margin: '0 auto' }}>
                <div>
                  <label htmlFor="spawnName" style={{ display: 'block', marginBottom: '5px' }}>Agent Name (Optional):</label>
                  <input
                    type="text"
                    id="spawnName"
                    name="name"
                    placeholder="Coder Assistant"
                    value={spawnAgentConfig.name}
                    onChange={(e) => setSpawnAgentConfig({ ...spawnAgentConfig, name: e.target.value })}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                  />
                </div>
                <div>
                  <label htmlFor="spawnDescription" style={{ display: 'block', marginBottom: '5px' }}>Agent Description (Optional):</label>
                  <textarea
                    id="spawnDescription"
                    name="description"
                    placeholder="Describe the agent's purpose or specialization"
                    value={spawnAgentConfig.description}
                    onChange={(e) => setSpawnAgentConfig({ ...spawnAgentConfig, description: e.target.value })}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd', minHeight: '60px' }}
                  ></textarea>
                </div>
                <div>
                  <label htmlFor="systemPrompt" style={{ display: 'block', marginBottom: '5px' }}>System Prompt:</label>
                  <textarea
                    id="systemPrompt"
                    name="systemPrompt"
                    value={spawnAgentConfig.systemPrompt}
                    onChange={(e) => setSpawnAgentConfig({ ...spawnAgentConfig, systemPrompt: e.target.value })}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd', minHeight: '80px' }}
                  ></textarea>
                </div>

                {/* Advanced Properties Toggle Button */}
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  style={{
                    padding: '8px 12px',
                    backgroundColor: '#6c757d',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    marginBottom: '10px', // Add some space below the button
                    width: 'fit-content', // Make button width fit content
                  }}
                >
                  {showAdvanced ? 'Hide' : 'Show'} Advanced Properties
                </button>

                {/* Advanced Properties Section */}
                {showAdvanced && (
                  <div style={{ border: '1px solid #eee', padding: '15px', borderRadius: '4px', display: 'grid', gap: '15px', marginBottom: '15px' }}>
                    <div>
                      <label htmlFor="model" style={{ display: 'block', marginBottom: '5px' }}>LLM Model:</label>
                      <input
                        type="text"
                    id="model"
                    name="model"
                    value={spawnAgentConfig.model}
                    onChange={(e) => setSpawnAgentConfig({ ...spawnAgentConfig, model: e.target.value })}
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                      />
                    </div>
                    <div>
                      <label htmlFor="apiBaseUrl" style={{ display: 'block', marginBottom: '5px' }}>API Base URL:</label>
                      <input
                        type="text"
                        id="apiBaseUrl"
                        name="apiBaseUrl"
                        value={spawnAgentConfig.apiBaseUrl}
                        onChange={(e) => setSpawnAgentConfig({ ...spawnAgentConfig, apiBaseUrl: e.target.value })}
                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                      />
                    </div>
                    <div>
                      <label htmlFor="port" style={{ display: 'block', marginBottom: '5px' }}>Agent Port (leave empty for random):</label>
                      <input
                        type="text" // Changed type to text to allow empty string
                        id="port"
                        name="port"
                        placeholder=""
                        value={spawnAgentConfig.port === 0 ? '' : spawnAgentConfig.port} // Display empty if 0, otherwise the number
                        onChange={(e) => {
                          const value = e.target.value;
                          // Allow empty string or valid numbers
                          if (value === '' || /^\d+$/.test(value)) {
                            setSpawnAgentConfig({ ...spawnAgentConfig, port: value === '' ? 0 : parseInt(value, 10) });
                          }
                        }}
                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
                      />
                    </div>
                  </div>
                )}
                {/* Spawn Status Message */}
                {spawnStatusMessage && (
                  <div style={{
                    marginTop: '10px',
                    padding: '10px',
                    borderRadius: '4px',
                    backgroundColor: spawnMessageType === 'success' ? '#d4edda' : '#f8d7da',
                    color: spawnMessageType === 'success' ? '#155724' : '#721c24',
                    border: `1px solid ${spawnMessageType === 'success' ? '#c3e6cb' : '#f5c6cb'}`,
                  }}>
                    {spawnStatusMessage}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={isSpawning} // Disable button while spawning
                  style={{
                    padding: '10px 15px',
                    backgroundColor: isSpawning ? '#6c757d' : '#007bff', // Grey out when disabled
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Spawn Agent
                </button>
              </form>
            </div>
          </>
        )}

        {/* Add External Agent Tab */}
        {activeTab === 'add' && (
          <div style={{ marginBottom: '30px' }}>
            <h2 style={{ marginBottom: '15px' }}>Add New Agent Endpoint</h2>
            <form onSubmit={handleAddAgent} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Agent Name (Optional)"
                value={newAgentName}
                onChange={(e) => setNewAgentName(e.target.value)}
                style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ddd', width: '200px' }}
              />
              <input
                type="text"
                placeholder="Enter agent URL"
                value={newAgentUrl}
                onChange={(e) => setNewAgentUrl(e.target.value)}
                required // URL is required
                style={{ flexGrow: 1, padding: '8px', borderRadius: '4px', border: '1px solid #ddd' }}
              />
              <button
                type="submit"
                style={{
                  padding: '8px 15px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Add Agent
              </button>
            </form>
          </div>
        )}
      </div>

      {/* TODO: Implement agent management UI */}
    </div>
  );
};

export default AgentManagement;
