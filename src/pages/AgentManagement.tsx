import React, { useState, useEffect } from 'react';
import axios from 'axios'; // Assuming axios is used for HTTP requests
import TaskList from '../components/TaskList'; // Import the TaskList component
import TaskSubmitForm from '../components/TaskSubmitForm'; // Import the new TaskSubmitForm component
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
  isLocal: boolean; // Add isLocal flag
}

const AgentManagement: React.FC = () => {
  const navigate = useNavigate(); // Add useNavigate hook
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

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

  return (
    <div className={styles.container}>
      <h1 className={styles.title}>Agent Management</h1>

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
        <h2 className={styles.agentListTitle}>Known Agents</h2>
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
                        <a href={agent.url + '/.well-known/agent.json'} target="_blank" rel="noopener noreferrer" className={styles.agentNameLink}>
                          {agent.name || 'Unnamed Agent'}
                        </a>
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
        {/* Display TaskList when an agent is selected */}
        {selectedAgentId && (
          <div className={styles.taskListSection}>
             <TaskList agentId={selectedAgentId} />
          </div>
        )}
      </div>

      {/* Add the Task Submit Form here */}
      <TaskSubmitForm />

      {/* Removed agent creation forms and tabs */}
    </div>
  );
};

export default AgentManagement;
