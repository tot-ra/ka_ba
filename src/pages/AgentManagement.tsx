import React, { useState, useEffect } from 'react';
import axios from 'axios'; // Assuming axios is used for HTTP requests
// Removed: import TaskSubmitForm from '../components/TaskSubmitForm';
import AgentInteraction from './AgentInteraction'; // Import AgentInteraction
import { useAgent } from '../contexts/AgentContext'; // Import useAgent hook
import { useNavigate } from 'react-router-dom';
import styles from './AgentManagement.module.css'; // Import the CSS module

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
    fetchAgentsFromContext();
  }, [fetchAgentsFromContext]);

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
    <div className={styles.splitContainer}> {/* Use a new class for the split layout */}
      {/* Left Pane: Agent List and Add Agent Buttons */}
      <div className={styles.leftPane}>
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
        </div>
      </div>

      {/* Right Pane: Agent Interaction (Tasks/Logs/Task Details) */}
      <div className={styles.rightPane}>
        {selectedAgentId ? (
          <AgentInteraction />
        ) : (
          <p>Select an agent from the list to view tasks and logs.</p>
        )}
      </div>
    </div>
  );
};

export default AgentManagement;
