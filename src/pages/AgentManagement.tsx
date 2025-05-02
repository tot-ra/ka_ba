import React, { useState, useEffect } from 'react';
import axios from 'axios'; // Assuming axios is used for HTTP requests
import TaskList from '../components/TaskList'; // Import the TaskList component
import TaskSubmitForm from '../components/TaskSubmitForm'; // Import the new TaskSubmitForm component
import { useNavigate } from 'react-router-dom';
import { Button, Box } from '@mui/material';

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
    <div style={{ padding: '20px', fontFamily: 'sans-serif' }}>
      <h1 style={{ marginBottom: '20px' }}>Agent Management</h1>

      {/* Add Agent Buttons */}
      <Box sx={{ mb: 3, display: 'flex', gap: 2 }}>
        <Button variant="contained" color="primary" onClick={() => navigate('/add-agent')}>
          Spawn Local Agent
        </Button>
        <Button variant="contained" color="secondary" onClick={() => navigate('/add-agent')}>
          Add External Agent
        </Button>
      </Box>

      {/* Agent List */}
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
        {/* Display TaskList when an agent is selected */}
        {selectedAgentId && (
          <div style={{ marginTop: '20px', borderTop: '1px solid #eee', paddingTop: '20px' }}>
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
