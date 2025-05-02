import React, { useState, useEffect } from 'react';
import axios from 'axios'; // Assuming axios is used for HTTP requests
// Removed: import TaskSubmitForm from '../components/TaskSubmitForm';
import AgentInteraction from './AgentInteraction'; // Import AgentInteraction
import { useAgent } from '../contexts/AgentContext'; // Import useAgent hook
import { useNavigate } from 'react-router-dom';
import styles from './AgentManagement.module.css'; // Import the CSS module

// Removed MUI imports: Button, Box

type Tab = 'manage' | 'add'; // This type seems unused now, consider removing if not needed elsewhere
type SpawnMessageType = 'success' | 'error' | null; // This type seems unused now, consider removing if not needed elsewhere

interface Agent {
  id: string;
  url: string;
  name?: string;
  description?: string;
  isLocal: boolean;
  pid?: number; // Add optional pid
}

const AgentManagement: React.FC = () => {
  const navigate = useNavigate();
  // Use context for agents and selectedAgentId
  const { agents, selectedAgentId, setSelectedAgentId, fetchAgents: fetchAgentsFromContext, loadingAgents, agentError } = useAgent();
  // Removed agentLogs and loadingLogs state

  useEffect(() => {
    // Fetch agents using context function on mount
    fetchAgentsFromContext();
    /* // Keep original fetch logic commented out for reference if needed
    const fetchAgents = async () => {
      setLoadingAgents(true); // Use context loading state if preferred
      try {
        const response = await axios.post('http://localhost:3000/graphql', {
          query: `
            query {
              agents {
                id
                url
                name
                description
                isLocal
                pid
              }
            }
          `,
        });
        setAgents(response.data.data.agents); // Use context setAgents if preferred
      } catch (error) {
        console.error('Error fetching agents:', error);
        // Use context setAgentError if preferred
      } finally {
        // Use context setLoadingAgents if preferred
      }
    };
    fetchAgents();
    */
  }, [fetchAgentsFromContext]); // Depend on context fetch function

  // Removed fetchAgentLogs function

  const handleSelectAgent = (agentId: string) => {
    setSelectedAgentId(agentId); // Use context setter
    console.log('[AgentManagement] Selected agent:', agentId);
    // No longer fetching historical logs here
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
        // Refresh the agent list via context after stopping
        fetchAgentsFromContext();
        // If the stopped agent was selected, deselect it via context
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

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Agents</h1>

      {/* Add Agent Buttons */}
      <div className={styles.buttonContainer}>
        <button className={`${styles.button} ${styles.buttonPrimary}`} onClick={() => navigate('/add-local-agent')}>
          Spawn Local Agent
        </button>
        <button className={`${styles.button} ${styles.buttonSecondary}`} onClick={() => navigate('/add-external-agent')}>
          Add External Agent
        </button>
      </div>

      {/* Agent List */}
      <div className={styles.agentListContainer}>
        <ul className={styles.agentList}>
          {agents.map(agent => (
                  <li key={agent.id} className={`${styles.agentListItem} ${selectedAgentId === agent.id ? styles.agentListItemSelected : ''}`}>
                    <div className={styles.agentInfo}>
                      <input
                        type="radio"
                        id={`agent-${agent.id}`}
                        name="selectedAgent"
                        value={agent.id}
                        checked={selectedAgentId === agent.id}
                        onChange={() => handleSelectAgent(agent.id)}
                        className={styles.agentRadio}
                      />
                      <label htmlFor={`agent-${agent.id}`} className={styles.agentLabel}>
                        <div className={styles.agentNameContainer}>
                          <a href={agent.url + '/.well-known/agent.json'} target="_blank" rel="noopener noreferrer" className={styles.agentNameLink}>
                            {agent.name || 'Unnamed Agent'}
                          </a>
                          <span className={styles.agentUrl}>({agent.url})</span> {/* Display URL */}
                          {agent.isLocal && agent.pid && <span className={styles.agentPid}> (PID: {agent.pid})</span>} {/* Display PID */}
                        </div>
                        {agent.description && <div className={styles.agentDescription}>{agent.description}</div>}
                      </label>
                    </div>
                    {/* Show stop button only for locally spawned agents */}
                    {agent.isLocal && (
                      <button
                        onClick={() => handleStopAgent(agent.id)}
                        className={styles.buttonDanger}
                      >
                        Stop
                      </button>
                    )}
                  </li>
                ))}
              </ul>
        {/* Display TaskList and Logs when an agent is selected */}
        {selectedAgentId && (
          <>
            <AgentInteraction />

          </> /* End of Fragment */
        )}
      </div>

      {/* Removed the separate rendering of TaskSubmitForm */}

      {/* Removed agent creation forms and tabs */}
    </div>
  );
};

export default AgentManagement;
