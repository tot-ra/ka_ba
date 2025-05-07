import React from 'react';
import { useNavigate } from 'react-router-dom';
import styles from './AgentList.module.css'; // Use a new CSS module

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
}

const AgentList: React.FC<AgentListProps> = ({
  agents,
  selectedAgentId,
  handleSelectAgent,
  handleStopAgent,
}) => {
  const navigate = useNavigate(); // useNavigate is used within the component for the buttons

  return (
    <div className={styles.leftPane}> {/* Use a new class for the split layout */}
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
  );
};

export default AgentList;
