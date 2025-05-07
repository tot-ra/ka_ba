import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { useNavigate, useParams } from 'react-router-dom'; // Import useParams
import styles from './AddLocalAgent.module.css'; // May need a new CSS module later

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
}

const EditLocalAgent: React.FC = () => {
  const navigate = useNavigate();
  const { agentId } = useParams<{ agentId: string }>(); // Get agentId from URL

  const [agentDetails, setAgentDetails] = useState<AgentDetails | null>(null);
  const [isLoadingAgent, setIsLoadingAgent] = useState(true);
  const [errorLoadingAgent, setErrorLoadingAgent] = useState<string | null>(null);

  const [availableTools, setAvailableTools] = useState<ToolDefinition[]>([]);
  const [selectedTools, setSelectedTools] = useState<string[]>([]);
  const [composedSystemPrompt, setComposedSystemPrompt] = useState<string>('');
  const [isFetchingTools, setIsFetchingTools] = useState(false);
  const [isComposingPrompt, setIsComposingPrompt] = useState(false);
  const [isUpdatingPrompt, setIsUpdatingPrompt] = useState(false);

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

  const handleToolSelection = (toolName: string) => {
    setSelectedTools(prevSelected =>
      prevSelected.includes(toolName)
        ? prevSelected.filter(name => name !== toolName)
        : [...prevSelected, toolName]
    );
  };

  const handleComposePrompt = async () => {
    if (!agentDetails || selectedTools.length === 0) {
      // Should not happen if button is disabled correctly, but good check
      return;
    }

    setIsComposingPrompt(true);
    try {
      const response = await axios.post('http://localhost:3000/graphql', {
        query: `
          mutation ComposeSystemPrompt($agentId: ID!, $toolNames: [String!]!) {
            composeSystemPrompt(agentId: $agentId, toolNames: $toolNames)
          }
        `,
        variables: { agentId: agentDetails.id, toolNames: selectedTools },
      });
      const composedPrompt = response.data.data.composeSystemPrompt;
      if (typeof composedPrompt === 'string') {
        setComposedSystemPrompt(composedPrompt);
      } else {
        console.error('Failed to compose system prompt or received invalid data:', response.data);
        // Optionally set an error message
      }
    } catch (error: any) {
      console.error('Error composing system prompt:', error);
      // Optionally set an error message
    } finally {
      setIsComposingPrompt(false);
    }
  };

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

  if (isLoadingAgent) {
    return <div className={styles.container}><p>Loading agent details...</p></div>;
  }

  if (errorLoadingAgent) {
    return <div className={styles.container}><p className={styles.alertError}>{errorLoadingAgent}</p></div>;
  }

  if (!agentDetails) {
     return <div className={styles.container}><p className={styles.alertInfo}>Agent details could not be loaded.</p></div>;
  }


  return (
    <div className={styles.container}>
      <div className={styles.paper}>
        <h2>Edit Local Agent: {agentDetails.name}</h2>
        <p>Agent ID: {agentDetails.id}</p>
        <p>Agent URL: {agentDetails.url}</p>
        {/* Basic agent info display - can add edit fields later if needed */}

        {/* Tool Selection and Prompt Composition */}
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
              <button
                onClick={handleComposePrompt}
                className={`${styles.button} ${styles.buttonSecondary}`}
                disabled={selectedTools.length === 0 || isComposingPrompt || isUpdatingPrompt}
              >
                {isComposingPrompt && <div className={styles.spinner}></div>}
                {isComposingPrompt ? 'Composing...' : 'Compose System Prompt'}
              </button>
            </div>
          ) : (
            <p>No tools available for this agent.</p>
          )}

          {composedSystemPrompt && (
            <div className={styles.composedPromptSection}>
              <h4>Composed System Prompt:</h4>
              <textarea
                value={composedSystemPrompt}
                onChange={(e) => setComposedSystemPrompt(e.target.value)} // Allow editing the composed prompt
                rows={10}
                className={styles.formTextarea}
              />
               <button
                onClick={handleUpdateAgentPrompt}
                className={`${styles.button} ${styles.buttonPrimary}`}
                disabled={isUpdatingPrompt}
              >
                {isUpdatingPrompt && <div className={styles.spinner}></div>}
                {isUpdatingPrompt ? 'Updating Agent...' : 'Update Agent with this Prompt'}
              </button>
            </div>
          )}
        </div>

        {/* Status Message - Can add a dedicated status message state for this component */}
        {/* {statusMessage && (
          <div className={`${styles.alert} ${messageType === 'success' ? styles.alertSuccess : messageType === 'error' ? styles.alertError : messageType === 'info' ? styles.alertInfo : ''}`}>
            {statusMessage}
          </div>
        )} */}

      </div>
    </div>
  );
};

export default EditLocalAgent;
