import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import styles from './EditLocalAgent.module.css'; // Use the new CSS module
import AgentList from '../components/AgentList'; // Import AgentList
import { useAgent } from '../contexts/AgentContext'; // Import useAgent hook
import Button from '../components/Button';
import AgentLogs from '../components/AgentLogs'; // Import AgentLogs
import { sendGraphQLRequest } from '../utils/graphqlClient'; // Import the sendGraphQLRequest utility

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
  llmProvider?: string; // Add LLM provider field
  llmModel?: string; // Add LLM model field
  llmApiBaseUrl?: string; // Add LLM API base URL field
  llmApiKey?: string; // Add LLM API key field
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
  const [llmProvider, setLlmProvider] = useState<string>('openai'); // Default to openai
  const [llmModel, setLlmModel] = useState<string>('');
  const [llmApiBaseUrl, setLlmApiBaseUrl] = useState<string>('');
  const [llmApiKey, setLlmApiKey] = useState<string>(''); // Sensitive, handle with care

  const [composedSystemPrompt, setComposedSystemPrompt] = useState<string>('');
  const [isFetchingTools, setIsFetchingTools] = useState(false);
  const [isComposingPrompt, setIsComposingPrompt] = useState(false);
  const [isUpdatingAgent, setIsUpdatingAgent] = useState(false); // Renamed from isUpdatingPrompt
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
        const response = await sendGraphQLRequest(`
            query GetAgent($agentId: ID!) {
              agent(id: $agentId) {
                id
                url
                name
                description
                isLocal
                systemPrompt # Fetch systemPrompt
                pid # Fetch pid
                llmProvider # Fetch LLM provider
                llmModel # Fetch LLM model
                llmApiBaseUrl # Fetch LLM API base URL
                llmApiKey # Fetch LLM API key
              }
            }
          `, { agentId });

        if (response.errors) {
          console.error('GraphQL errors fetching agent details:', response.errors);
          setErrorLoadingAgent('Failed to fetch agent details: ' + response.errors.map(err => err.message).join(', '));
          setIsLoadingAgent(false);
        } else if (response.data?.agent) {
          const agent = response.data.agent as AgentDetails; // Add type assertion
          setAgentDetails(agent);
          setComposedSystemPrompt(agent.systemPrompt || ''); // Initialize prompt with existing one
          setLlmProvider(agent.llmProvider || 'openai'); // Initialize LLM provider
          setLlmModel(agent.llmModel || ''); // Initialize LLM model
          setLlmApiBaseUrl(agent.llmApiBaseUrl || ''); // Initialize LLM API base URL
          setLlmApiKey(agent.llmApiKey || ''); // Initialize LLM API key

          // Note: We don't have info on *which* tools were used to compose the *current* prompt,
          // so we'll just fetch available tools and let the user re-select/re-compose if needed.
          fetchAvailableTools(agent.id);
        } else {
          setErrorLoadingAgent('Agent not found or failed to fetch details.');
          setIsLoadingAgent(false);
        }
      } catch (error: any) {
        console.error('Error fetching agent details:', error);
        setErrorLoadingAgent(`Error loading agent: ${error.message}`);
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
        const GET_AGENTS_QUERY = `
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
          `;
        const response = await sendGraphQLRequest(GET_AGENTS_QUERY);

        if (response.errors) {
          console.error('GraphQL errors fetching agents:', response.errors);
          setErrorLoadingAgents('Failed to load agent list: ' + response.errors.map(err => err.message).join(', '));
        } else if (Array.isArray(response.data?.agents)) {
          setAllAgents(response.data.agents as AgentDetails[]); // Add type assertion
        } else {
          console.error('Failed to fetch agents or received invalid data:', response);
          setErrorLoadingAgents('Failed to load agent list.');
        }
      } catch (error: any) {
        console.error('Error fetching agents:', error);
        setErrorLoadingAgents(`Error loading agent list: ${error.message}`);
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
      const AVAILABLE_TOOLS_QUERY = `
          query AvailableTools($agentId: ID!) {
            availableTools(agentId: $agentId) {
              name
              description
            }
            }
          `;
      const response = await sendGraphQLRequest(AVAILABLE_TOOLS_QUERY, { agentId });

      if (response.errors) {
        console.error('GraphQL errors fetching available tools:', response.errors);
        // Optionally set an error message for tools
      } else if (Array.isArray(response.data?.availableTools)) {
        setAvailableTools(response.data.availableTools as ToolDefinition[]); // Add type assertion
      } else {
        console.error('Failed to fetch available tools or received invalid data:', response);
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
          console.log('Sending ComposeSystemPrompt request from useEffect...'); // Added log
          const COMPOSE_PROMPT_MUTATION = `
              mutation ComposeSystemPrompt($agentId: ID!, $toolNames: [String!]!, $mcpServerNames: [String!]!) {
                composeSystemPrompt(agentId: $agentId, toolNames: $toolNames, mcpServerNames: $mcpServers.map(server => server.name))
              }
            `;
          const response = await sendGraphQLRequest(COMPOSE_PROMPT_MUTATION, {
            agentId: agentDetails.id,
            toolNames: availableTools.map(tool => tool.name),
            mcpServerNames: mcpServers.map(server => server.name),
          });

          console.log('Composed system prompt full response from useEffect:', response); // Modified log
          if (response.errors) {
            console.error('GraphQL errors auto-composing system prompt from useEffect:', response.errors); // Modified log
            console.error('GraphQL response errors details from useEffect:', response.errors); // Added specific error logging
          } else if (response.data) { // Check for data presence
             console.log('GraphQL response data from useEffect:', response.data); // Added specific data logging
            if (typeof response.data.composeSystemPrompt === 'string') {
              setComposedSystemPrompt(response.data.composeSystemPrompt as string); // Add type assertion
            } else {
               console.error('composeSystemPrompt field is not a string or is missing in response data from useEffect:', response.data); // Added check for expected data type
            }
          } else {
             console.error('GraphQL response has no data or errors from useEffect:', response); // Added check for empty response
          }
        } catch (error: any) { // Added type assertion for error
          console.error('Error sending or processing ComposeSystemPrompt request from useEffect:', error); // Modified log and added catch
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
        const COMPOSE_PROMPT_MUTATION = `
            mutation ComposeSystemPrompt($agentId: ID!, $toolNames: [String!]!, $mcpServerNames: [String!]!) {
              composeSystemPrompt(agentId: $agentId, toolNames: $toolNames, mcpServerNames: $selectedMcpServers)
            }
          `;
        sendGraphQLRequest(COMPOSE_PROMPT_MUTATION, {
          agentId: agentDetails.id,
          toolNames: newSelection,
          mcpServerNames: selectedMcpServers, // Include current MCP server selection
        })
          .then(response => {
            if (response.errors) {
              console.error('GraphQL errors recomposing system prompt:', response.errors);
            } else if (typeof response.data?.composeSystemPrompt === 'string') {
              setComposedSystemPrompt(response.data.composeSystemPrompt as string); // Add type assertion
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
        console.log('Sending ComposeSystemPrompt request from handleMcpServerSelection...'); // Added log
        sendGraphQLRequest(`
            mutation ComposeSystemPrompt($agentId: ID!, $toolNames: [String!]!, $mcpServerNames: [String!]!) {
              composeSystemPrompt(agentId: $agentId, toolNames: $selectedTools, mcpServerNames: $newSelection)
            }
          `, {
          agentId: agentDetails.id,
          toolNames: selectedTools, // Include current tool selection
          mcpServerNames: newSelection,
        })
          .then(response => {
            console.log('ComposeSystemPrompt full response in handleMcpServerSelection:', response); // Modified log
            if (response.errors) {
              console.error('GraphQL errors recomposing system prompt in handleMcpServerSelection:', response.errors); // Modified log
              console.error('GraphQL response errors details:', response.errors); // Added specific error logging
            } else if (response.data) { // Check for data presence
              console.log('GraphQL response data in handleMcpServerSelection:', response.data); // Added specific data logging
              if (typeof response.data.composeSystemPrompt === 'string') {
                setComposedSystemPrompt(response.data.composeSystemPrompt as string); // Add type assertion
              } else {
                 console.error('composeSystemPrompt field is not a string or is missing in response data:', response.data); // Added check for expected data type
              }
            } else {
               console.error('GraphQL response has no data or errors in handleMcpServerSelection:', response); // Added check for empty response
            }
          })
          .catch(error => {
            console.error('Error sending or processing ComposeSystemPrompt request from handleMcpServerSelection:', error); // Modified log and added catch
          })
          .finally(() => {
            setIsComposingPrompt(false);
          });
      }

      return newSelection;
    });
  }, [agentDetails?.id, selectedTools]); // Depend on agentDetails and selectedTools


  // The handleComposePrompt function has been removed

  const handleUpdateAgentConfig = async () => { // Renamed function
    if (!agentDetails) {
      // Should not happen if button is disabled correctly
      return;
    }

    setIsUpdatingAgent(true); // Use new state
    try {
      const UPDATE_AGENT_CONFIG_MUTATION = `
          mutation UpdateAgentConfig($agentId: ID!, $config: InputAgentConfig!) {
            updateAgentConfig(agentId: $agentId, config: $config) {
              id
              name
              llmProvider
              llmModel
              llmApiBaseUrl
              llmApiKey
              systemPrompt
            }
          }
        `;
      const response = await sendGraphQLRequest(UPDATE_AGENT_CONFIG_MUTATION, {
        agentId: agentDetails.id,
        config: {
          systemPrompt: composedSystemPrompt,
          llmProvider: llmProvider,
          llmModel: llmModel,
          llmApiBaseUrl: llmApiBaseUrl,
          llmApiKey: llmApiKey, // Send API key (handle sensitivity on backend)
          // Add other configurable fields here if needed (name, description)
        },
      });

      if (response.errors) {
        console.error('GraphQL errors updating agent config:', response.errors);
        // Optionally set an error message
      } else if (response.data?.updateAgentConfig?.id) {
        // Success - maybe show a message or navigate back
        console.log('Agent configuration updated:', response.data.updateAgentConfig);
        // Optionally navigate back to agent list or show success
        // navigate('/agents');

        // Add navigation to agent view page
        navigate(`/agents/view/${agentDetails.id}`);

      } else {
        console.error('Failed to update agent config or received invalid data:', response);
        // Optionally set an error message
      }
    } catch (error: any) {
      console.error('Error updating agent config:', error);
      // Optionally set an error message
    } finally {
      setIsUpdatingAgent(false); // Use new state
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
      const response = await sendGraphQLRequest(`
          mutation StopKaAgent($id: ID!) {
            stopKaAgent(id: $id)
          }
        `, {
        id: agentId,
      });
      if (response.errors) {
        console.error('GraphQL errors stopping agent:', response.errors);
      } else if (response.data?.stopKaAgent) {
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
              <h3>LLM Configuration</h3>
              <div className={styles.formGroup}>
                <label htmlFor="llmProvider">LLM Provider:</label>
                <select
                  id="llmProvider"
                  value={llmProvider}
                  onChange={(e) => setLlmProvider(e.target.value)}
                  className={styles.formSelect}
                >
                  <option value="openai">OpenAI Compatible</option>
                  <option value="gemini">Google Gemini</option>
                  {/* Add other providers here */}
                </select>
              </div>

              {llmProvider === 'openai' && (
                <>
                  <div className={styles.formGroup}>
                    <label htmlFor="llmApiBaseUrl">API Base URL:</label>
                    <input
                      type="text"
                      id="llmApiBaseUrl"
                      value={llmApiBaseUrl}
                      onChange={(e) => setLlmApiBaseUrl(e.target.value)}
                      className={styles.formInput}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label htmlFor="llmModel">Model Name:</label>
                    <input
                      type="text"
                      id="llmModel"
                      value={llmModel}
                      onChange={(e) => setLlmModel(e.target.value)}
                      className={styles.formInput}
                    />
                  </div>
                   {/* Optionally add API Key field for OpenAI if needed */}
                </>
              )}

              {llmProvider === 'gemini' && (
                <>
                  <div className={styles.formGroup}>
                    <label htmlFor="llmModel">Model Name:</label>
                    <input
                      type="text"
                      id="llmModel"
                      value={llmModel}
                      onChange={(e) => setLlmModel(e.target.value)}
                      className={styles.formInput}
                    />
                  </div>
                  <div className={styles.formGroup}>
                    <label htmlFor="llmApiKey">API Key:</label>
                    <input
                      type="password" // Use password type for sensitive input
                      id="llmApiKey"
                      value={llmApiKey}
                      onChange={(e) => setLlmApiKey(e.target.value)}
                      className={styles.formInput}
                    />
                  </div>
                </>
              )}


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
                    onClick={handleUpdateAgentConfig} // Use new handler
                    disabled={isUpdatingAgent || isComposingPrompt} // Disable while composing or updating
                    variant="primary"
                  >
                    {isUpdatingAgent || isComposingPrompt ? <div className={styles.spinner}></div> : null}
                    {isUpdatingAgent ? 'Updating Agent...' : isComposingPrompt ? 'Composing Prompt...' : 'Update Agent Configuration'}
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
