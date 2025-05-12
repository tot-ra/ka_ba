import React, { useState, useEffect } from 'react';
import axios from 'axios'; // Assuming axios is used for HTTP requests
// Removed: import TaskSubmitForm from '../components/TaskSubmitForm';
import AgentInteraction from './AgentInteraction'; // Import AgentInteraction
import { useAgent } from '../contexts/AgentContext'; // Import useAgent hook
import { useNavigate, useParams } from 'react-router-dom'; // Import useParams
import styles from './AgentManagement.module.css'; // Import the CSS module
import AgentList from '../components/AgentList'; // Import the new AgentList component
import Button from '../components/Button'; // Import Button for the add buttons

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
  const { agentId: urlAgentId } = useParams<{ agentId?: string }>(); // Get agentId from URL
  // Use context for agents and selectedAgentId
  const { agents, selectedAgentId, setSelectedAgentId, fetchAgents: fetchAgentsFromContext, loadingAgents, agentError } = useAgent();
  // Removed agentLogs and loadingLogs state

  useEffect(() => {
    fetchAgentsFromContext();
  }, [fetchAgentsFromContext]);

  // Effect to select agent from URL
  useEffect(() => {
    if (urlAgentId) {
      setSelectedAgentId(urlAgentId);
    }
  }, [urlAgentId, setSelectedAgentId]);

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
      {/* Left Pane: Agent List */}
      {loadingAgents ? (
        <p>Loading agents...</p>
      ) : agentError ? (
        <p className={styles.alertError}>{agentError}</p>
      ) : (
        <AgentList
          agents={agents}
          selectedAgentId={selectedAgentId}
          handleSelectAgent={handleSelectAgent}
          handleStopAgent={handleStopAgent}
        />
      )}

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
