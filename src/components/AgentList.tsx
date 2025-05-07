import React from 'react';
import { useNavigate } from 'react-router-dom'; // Keep useNavigate for the Edit button
import styles from './AgentList.module.css'; // Use a new CSS module
import Button from './Button'; // Import the new Button component

interface Agent {
  id: string;
  url: string;
  name?: string;
  description?: string;
  isLocal: boolean;
  pid?: number;
}

interface AgentListProps {
  agents: Agent[];
  selectedAgentId: string | null;
  handleSelectAgent: (agentId: string) => void;
  handleStopAgent: (agentId: string) => Promise<void>;
  // Removed showAddButtons prop - buttons are handled by parent
}

const AgentList: React.FC<AgentListProps> = ({
  agents,
  selectedAgentId,
  handleSelectAgent,
  handleStopAgent,
}) => {
  const navigate = useNavigate(); // Keep useNavigate for the Edit button

  return (
    <div className={styles.agentListContainer}> {/* Use a class for the main container */}
      <h1 className={styles.title}>Agents</h1>

      {/* Add Agent Buttons - Removed from here, handled by parent */}

      {/* Agent List */}
      <div className={styles.listWrapper}> {/* Added a wrapper for the actual list */}
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
                      <span className={styles.agentNameLink}>{agent.name || 'Unnamed Agent'}</span>
                      <a className={styles.agentUrl}
                      href={agent.url + '/.well-known/agent.json'} target="_blank" rel="noopener noreferrer">
                      ({agent.url})
                      </a>
                      {agent.pid && <span className={styles.agentPid}> (PID: {agent.pid})</span>} {/* Display PID */}
                    </div>
                    {agent.description && <div className={styles.agentDescription}>{agent.description}</div>}
                  </label>
                </div>
                {/* Show buttons only for locally spawned agents */}
                {agent.isLocal && (
                  <div className={styles.agentActions}>
                    <Button
                      onClick={() => navigate(`/agents/edit/${agent.id}`)}
                      variant="secondary"
                    >
                      Edit
                    </Button>
                    <Button
                      onClick={() => handleStopAgent(agent.id)}
                      variant="danger"
                    >
                      Stop
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
      </div>
    </div>
  );
};

export default AgentList;
