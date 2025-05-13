import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom';
import styles from './EditLocalAgent.module.css'; // Use the new CSS module
import AgentList from '../components/AgentList'; // Import AgentList
import { useAgent } from '../contexts/AgentContext'; // Import useAgent hook
import Button from '../components/Button';
import AgentLogs from '../components/AgentLogs'; // Import AgentLogs
import { sendGraphQLRequest } from '../utils/graphqlClient'; // Import the sendGraphQLRequest utility

type MessageType = 'success' | 'error' | 'info' | null;

interface ToolDefinition {
  name: string;
  description: string;
}

interface AgentDetails {
  id: string;
  url: string;
  name: string;
  description: string;
  isLocal: boolean;
  systemPrompt?: string; // Add systemPrompt field
  pid?: number; // Add pid for AgentList
}

interface McpServerConfig {
  name: string;
  timeout: number;
  command: string;
  args: string[];
  transportType: string;
  env: { [key: string]: string };
}

const EditLocalAgent: React.FC = () => {
  const navigate = useNavigate();
  const { agentId } = useParams<{ agentId: string }>(); // Get agentId from URL

  // Use context for agents and selectedAgentId
  const { fetchAgents: fetchAgentsFromContext, setSelectedAgentId } = useAgent();

  const [agentDetails, setAgentDetails] = useState<AgentDetails | null>(null);
  const [isLoadingAgent, setIsLoadingAgent] = useState(true);
  const [errorLoadingAgent, setErrorLoadingAgent] = useState<string | null>(null);

  const [allAgents, setAllAgents] = useState<AgentDetails[]>([]); // State for all agents
  const [isLoadingAgents, setIsLoadingAgents] = useState(true); // Loading state for all agents
  const [errorLoadingAgents, setErrorLoadingAgents] = useState<string | null>(null);

  const [mcpServers, setMcpServers] = useState<McpServerConfig[]>([]); // State for MCP servers
  const [isLoadingMcpServers, setIsLoadingMcpServers] = useState(true); // Loading state for MCP servers
  const [errorLoadingMcpServers, setErrorLoadingMcpServers] = useState<string | null>(null);

  const [availableTools, setAvailableTools] = useState<ToolDefinition[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]); // Stores names of selected regular tools
  const [selectedMcpServers, setSelectedMcpServers] = useState<string[]>([]); // Stores names of selected MCP servers
  const [composedSystemPrompt, setComposedSystemPrompt] = useState<string>('');
  const [isFetchingTools, setIsFetchingTools] = useState(false);
  const [isComposingPrompt, setIsComposingPrompt] = useState(false);
  const [isUpdatingPrompt, setIsUpdatingPrompt] = useState(false);
  const [currentViewTab, setCurrentViewTab] = useState<'details' | 'logs'>('details'); // State for active tab

  // Fetch agent details on component mount
  useEffect(() => {
    const fetchAgentDetails = async () => {
      if (!agentId) {
        setErrorLoadingAgent('Agent ID is missing.');
        setIsLoadingAgent(false);
        return;
      }
      setIsLoadingAgent(true);
      setErrorLoadingAgent(null);
      try {
        const response = await axios.post('http://localhost:3000/graphql', {
          query: `
            query GetAgent($agentId: ID!) {
              agent(id: $agentId) {
                id
                url
                name
                description
                isLocal
                systemPrompt # Fetch systemPrompt
                pid # Fetch pid
              }
            }
          `,
          variables: { agentId },
        });
        const agent = response.data.data.agent;
        if (agent && agent.id) {
          setAgentDetails(agent);
          setComposedSystemPrompt(agent.systemPrompt || ''); // Initialize prompt with existing one
          // Note: We don't have info on *which* tools were used to compose the *current* prompt,
          // so we'll just fetch available tools and let the user re-select/re-compose if needed.
          fetchAvailableTools(agent.id);
        } else {
          setErrorLoadingAgent('Agent not found or failed to fetch details.');
          setIsLoadingAgent(false);
        }
      } catch (error: any) {
        console.error('Error fetching agent details:', error);
        const message = error.response?.data?.errors?.[0]?.message || error.message || 'An unknown error occurred.';
        setErrorLoadingAgent(`Error loading agent: ${message}`);
        setIsLoadingAgent(false);
      }
    };

    fetchAgentDetails();
  }, [agentId]); // Re-run effect if agentId changes

  // Fetch all agents for the list
  useEffect(() => {
    const fetchAllAgents = async () => {
      setIsLoadingAgents(true);
      setErrorLoadingAgents(null);
      try {
        const response = await axios.post('http://localhost:3000/graphql', {
          query: `
            query GetAgents {
              agents {
                id
                url
                name
                description
                isLocal
                pid # Fetch pid for AgentList
              }
            }
          `,
        });
        const agents = response.data.data.agents;
        if (Array.isArray(agents)) {
          setAllAgents(agents);
        } else {
          console.error('Failed to fetch agents or received invalid data:', response.data);
          setErrorLoadingAgents('Failed to load agent list.');
        }
      } catch (error: any) {
        console.error('Error fetching agents:', error);
        const message = error.response?.data?.errors?.[0]?.message || error.message || 'An unknown error occurred.';
        setErrorLoadingAgents(`Error loading agent list: ${message}`);
      } finally {
        setIsLoadingAgents(false);
      }
    };

    fetchAllAgents();
  }, []); // Fetch agents only once on mount

  // Fetch MCP servers on component mount
  useEffect(() => {
    const fetchMcpServers = async () => {
      setIsLoadingMcpServers(true);
      setErrorLoadingMcpServers(null);
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
      try {
        const response = await sendGraphQLRequest(GET_MCP_SERVERS_QUERY);

        if (response.errors) {
          console.error('GraphQL errors fetching MCP servers:', response.errors);
          setErrorLoadingMcpServers('Failed to fetch MCP servers: ' + response.errors.map(err => err.message).join(', '));
        } else if (response.data?.mcpServers) {
          console.log('MCP servers fetched successfully:', response.data.mcpServers);
          setMcpServers(response.data.mcpServers);
        } else {
          console.error('Unexpected GraphQL response fetching MCP servers:', response);
          setErrorLoadingMcpServers('Failed to fetch MCP servers: Unexpected response from server.');
        }
      } catch (error: any) {
        setErrorLoadingMcpServers('Failed to fetch MCP servers: ' + error.message);
        console.error('Error fetching MCP servers:', error);
      } finally {
        setIsLoadingMcpServers(false);
      }
    };

    fetchMcpServers();
  }, []); // Fetch MCP servers only once on mount


  const fetchAvailableTools = async (agentId: string) => {
    setIsFetchingTools(true);
    try {
      const response = await axios.post('http://localhost:3000/graphql', {
        query: `
          query AvailableTools($agentId: ID!) {
            availableTools(agentId: $agentId) {
              name
              description
            }
          }
        `,
        variables: { agentId },
      });
      const tools = response.data.data.availableTools;
      if (Array.isArray(tools)) {
        setAvailableTools(tools);
      } else {
        console.error('Failed to fetch available tools or received invalid data:', response.data);
        // Optionally set an error message for tools
      }
    } catch (error: any) {
      console.error('Error fetching available tools:', error);
      // Optionally set an error message for tools
    } finally {
      setIsFetchingTools(false);
      setIsLoadingAgent(false); // Loading is complete after fetching tools
    }
  };

  // Add a new useEffect to automatically select all tools and compose prompt when tools and MCP servers are loaded
  useEffect(() => {
    if (availableTools.length > 0 && mcpServers.length > 0 && agentDetails?.id) {
      // Select all tools automatically
      setSelectedTools(availableTools.map(tool => tool.name));
      // Select all MCP servers automatically
      setSelectedMcpServers(mcpServers.map(server => server.name));
      
      // Trigger prompt composition automatically
      const composePromptWithAll = async () => {
        setIsComposingPrompt(true);
        try {
          const response = await axios.post('http://localhost:3000/graphql', {
            query: `
              mutation ComposeSystemPrompt($agentId: ID!, $toolNames: [String!]!, $mcpServerNames: [String!]!) {
                composeSystemPrompt(agentId: $agentId, toolNames: $toolNames, mcpServerNames: $mcpServerNames)
              }
            `,
            variables: { 
              agentId: agentDetails.id, 
              toolNames: availableTools.map(tool => tool.name),
              mcpServerNames: mcpServers.map(server => server.name),
            },
          });
          const composedPrompt = response.data.data.composeSystemPrompt;
          if (typeof composedPrompt === 'string') {
            setComposedSystemPrompt(composedPrompt);
          }
        } catch (error) {
          console.error('Error auto-composing system prompt:', error);
        } finally {
          setIsComposingPrompt(false);
        }
      };
      
      composePromptWithAll();
    }
  }, [availableTools, mcpServers, agentDetails?.id]); // Depend on both tools and MCP servers

  const handleToolSelection = useCallback((toolName: string) => {
    setSelectedTools(prevSelected => {
      const newSelection = prevSelected.includes(toolName)
        ? prevSelected.filter(name => name !== toolName)
        : [...prevSelected, toolName];
      
      // Automatically recompose prompt when selection changes
      if (agentDetails?.id) {
        setIsComposingPrompt(true);
        axios.post('http://localhost:3000/graphql', {
          query: `
            mutation ComposeSystemPrompt($agentId: ID!, $toolNames: [String!]!, $mcpServerNames: [String!]!) {
              composeSystemPrompt(agentId: $agentId, toolNames: $toolNames, mcpServerNames: $mcpServerNames)
            }
          `,
          variables: { 
            agentId: agentDetails.id, 
            toolNames: newSelection,
            mcpServerNames: selectedMcpServers, // Include current MCP server selection
          },
        })
        .then(response => {
          const composedPrompt = response.data.data.composeSystemPrompt;
          if (typeof composedPrompt === 'string') {
            setComposedSystemPrompt(composedPrompt);
          }
        })
        .catch(error => {
          console.error('Error recomposing system prompt:', error);
        })
        .finally(() => {
          setIsComposingPrompt(false);
        });
      }
      
      return newSelection;
    });
  }, [agentDetails?.id, selectedMcpServers]); // Depend on agentDetails and selectedMcpServers

  const handleMcpServerSelection = useCallback((serverName: string) => {
    setSelectedMcpServers(prevSelected => {
      const newSelection = prevSelected.includes(serverName)
        ? prevSelected.filter(name => name !== serverName)
        : [...prevSelected, serverName];

      // Automatically recompose prompt when selection changes
      if (agentDetails?.id) {
        setIsComposingPrompt(true);
        axios.post('http://localhost:3000/graphql', {
          query: `
            mutation ComposeSystemPrompt($agentId: ID!, $toolNames: [String!]!, $mcpServerNames: [String!]!) {
              composeSystemPrompt(agentId: $agentId, toolNames: $toolNames, mcpServerNames: $mcpServerNames)
            }
          `,
          variables: {
            agentId: agentDetails.id,
            toolNames: selectedTools, // Include current tool selection
            mcpServerNames: newSelection,
          },
        })
        .then(response => {
          const composedPrompt = response.data.data.composeSystemPrompt;
          if (typeof composedPrompt === 'string') {
            setComposedSystemPrompt(composedPrompt);
          }
        })
        .catch(error => {
          console.error('Error recomposing system prompt:', error);
        })
        .finally(() => {
          setIsComposingPrompt(false);
        });
      }

      return newSelection;
    });
  }, [agentDetails?.id, selectedTools]); // Depend on agentDetails and selectedTools


  // The handleComposePrompt function has been removed

  const handleUpdateAgentPrompt = async () => {
    if (!agentDetails || !composedSystemPrompt) {
      // Should not happen if button is disabled correctly
      return;
    }

    setIsUpdatingPrompt(true);
    try {
      const response = await axios.post('http://localhost:3000/graphql', {
        query: `
          mutation UpdateAgentSystemPrompt($agentId: ID!, $systemPrompt: String!) {
            updateAgentSystemPrompt(agentId: $agentId, systemPrompt: $systemPrompt) {
              id
              name
            }
          }
        `,
        variables: { agentId: agentDetails.id, systemPrompt: composedSystemPrompt },
      });
      const updatedAgent = response.data.data.updateAgentSystemPrompt;
      if (updatedAgent && updatedAgent.id) {
        // Success - maybe show a message or navigate back
        console.log('Agent system prompt updated:', updatedAgent);
        // Optionally navigate back to agent list or show success
        // navigate('/agents');

        // Add navigation to agent view page
        navigate(`/agents/view/${agentDetails.id}`);

      } else {
        console.error('Failed to update agent system prompt or received invalid data:', response.data);
        // Optionally set an error message
      }
    } catch (error: any) {
      console.error('Error updating agent system prompt:', error);
      // Optionally set an error message
    } finally {
      setIsUpdatingPrompt(false);
    }
  };

  // Placeholder handlers for AgentList - actual logic needs to be implemented or state lifted
  const handleSelectAgent = useCallback((id: string) => {
    // Navigate to the edit page for the selected agent
    navigate(`/agents/edit/${id}`);
  }, [navigate]);

  const handleStopAgent = useCallback(async (agentId: string) => {
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
        // Refresh the agent list via context after stopping
        fetchAgentsFromContext();
        // If the stopped agent was selected, deselect it via context and navigate back to the list
        if (agentDetails?.id === agentId) { // Use agentDetails?.id to check if the current agent is the one stopped
          setSelectedAgentId(null);
          navigate('/agents'); // Navigate back to the agent list
        }
      } else {
        console.error('Failed to stop agent:', agentId);
      }
    } catch (error) {
      console.error('Error stopping agent:', error);
    }
  }, [fetchAgentsFromContext, setSelectedAgentId, agentDetails?.id]); // Add dependencies


  if (isLoadingAgent || isLoadingAgents || isLoadingMcpServers) {
    return <div className={styles.splitViewContainer}><div className={styles.leftPane}><p>Loading agent details, list, and MCP servers...</p></div></div>;
  }

  if (errorLoadingAgent) {
    return <div className={styles.splitViewContainer}><div className={styles.leftPane}><p className={styles.alertError}>{errorLoadingAgent}</p></div></div>;
  }

  if (errorLoadingMcpServers) {
    return <div className={styles.splitViewContainer}><div className={styles.leftPane}><p className={styles.alertError}>{errorLoadingMcpServers}</p></div></div>;
  }

  if (!agentDetails) {
     return <div className={styles.splitViewContainer}><div className={styles.leftPane}><p className={styles.alertInfo}>Agent details could not be loaded.</p></div></div>;
  }


  // Tab styles (can be moved to CSS module if preferred)
  const tabStyle: React.CSSProperties = {
    padding: '10px 15px',
    cursor: 'pointer',
    border: '1px solid #ccc',
    borderBottom: 'none',
    marginRight: '5px',
    borderRadius: '4px 4px 0 0',
    backgroundColor: '#f0f0f0', // Slightly different from AgentInteraction for distinction
    opacity: 0.7,
  };
  const activeTabStyle: React.CSSProperties = {
    ...tabStyle,
    backgroundColor: '#fff',
    borderBottom: '1px solid #fff',
    fontWeight: 'bold',
    opacity: 1,
  };

  return (
    <div className={styles.splitViewContainer}>
      {isLoadingAgents ? (
        <p>Loading agent list...</p>
      ) : errorLoadingAgents ? (
        <p className={styles.alertError}>{errorLoadingAgents}</p>
      ) : (
        <AgentList
          agents={allAgents}
          selectedAgentId={agentId || null} // Highlight the currently edited agent
          handleSelectAgent={handleSelectAgent}
          handleStopAgent={handleStopAgent} // Use placeholder for now
        />
      )}
      <div className={styles.editFormPane}> {/* Edit form on the right */}
        <div style={{ marginBottom: '1rem', borderBottom: '1px solid #ccc', paddingBottom: '0px' }}>
          <button
            style={currentViewTab === 'details' ? activeTabStyle : tabStyle}
            onClick={() => setCurrentViewTab('details')}
          >
            Details
          </button>
          <button
            style={currentViewTab === 'logs' ? activeTabStyle : tabStyle}
            onClick={() => setCurrentViewTab('logs')}
          >
            Logs
          </button>
        </div>

        {currentViewTab === 'details' && (
          <div className={styles.paper}>
            <h2>Edit Local Agent: {agentDetails.name}</h2>
            <p>Agent PID: {agentDetails.pid}</p>
            <p>Agent URL: <a target="_blank" rel="noopener noreferrer" href={agentDetails.url}>{agentDetails.url}</a></p>

            <div className={styles.toolSelectionSection}>
              <h3>Available Tools</h3>
              {isFetchingTools ? (
                <p>Loading tools...</p>
              ) : availableTools.length > 0 ? (
                <div>
                  {availableTools.map(tool => (
                    <div key={tool.name} className={styles.toolCheckbox}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedTools.includes(tool.name)}
                          onChange={() => handleToolSelection(tool.name)}
                        />
                        <strong>{tool.name}:</strong> {tool.description}
                      </label>
                    </div>
                  ))}
                </div>
              ) : (
                <p>No tools available for this agent.</p>
              )}

              <h3>Available MCP Servers</h3>
              {isLoadingMcpServers ? (
                <p>Loading MCP servers...</p>
              ) : mcpServers.length > 0 ? (
                <div>
                  {mcpServers.map(server => (
                    <div key={server.name} className={styles.toolCheckbox}> {/* Reuse toolCheckbox style */}
                      <label>
                        <input
                          type="checkbox"
                          checked={selectedMcpServers.includes(server.name)}
                          onChange={() => handleMcpServerSelection(server.name)}
                        />
                        <strong>{server.name}:</strong> {server.transportType} ({server.command} {server.args.join(' ')})
                      </label>
                    </div>
                  ))}
                </div>
              ) : (
                <p>No MCP servers configured.</p>
              )}


              {composedSystemPrompt && (
                <div className={styles.composedPromptSection}>
                  <h4>System Prompt:</h4>
                  <textarea
                    value={composedSystemPrompt}
                    onChange={(e) => setComposedSystemPrompt(e.target.value)}
                    rows={30}
                    className={styles.formTextarea}
                  />

                  <Button
                      onClick={() => navigate('/agents')}
                      variant="secondary"
                      style={{ marginBottom: '16px', marginRight: '8px' }}
                  >
                    &larr; Back to Agent List
                  </Button>

                  <Button
                    onClick={handleUpdateAgentPrompt}
                    disabled={isUpdatingPrompt || isComposingPrompt} // Disable while composing
                    variant="primary"
                  >
                    {isUpdatingPrompt || isComposingPrompt ? <div className={styles.spinner}></div> : null}
                    {isUpdatingPrompt ? 'Updating Agent...' : isComposingPrompt ? 'Composing Prompt...' : 'Update Agent with this Prompt'}
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
        {currentViewTab === 'logs' && agentId && (
          <div className={styles.logsPaper} style={{paddingTop: "10px"}}> {/* Added paddingTop to prevent overlap with tab border */}
            <AgentLogs agentId={agentId} />
          </div>
        )}
      </div>
    </div>
  );
};

export default EditLocalAgent;
