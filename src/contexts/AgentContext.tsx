import React, { createContext, useState, useContext, ReactNode, useEffect, useCallback } from 'react';
import axios from 'axios'; // Assuming axios is available

// Define Agent interface (consistent with AgentManagement)
interface Agent {
  id: string;
  url: string;
  name?: string;
  description?: string;
  isLocal: boolean;
  pid?: number; // Add optional pid field
}

interface AgentContextType {
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string | null) => void;
  agents: Agent[];
  fetchAgents: () => Promise<void>; // Function to fetch/refresh agents
  loadingAgents: boolean;
  agentError: string | null;
}

const AgentContext = createContext<AgentContextType | undefined>(undefined);

export const AgentProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState<boolean>(true);
  const [agentError, setAgentError] = useState<string | null>(null);

  const fetchAgents = useCallback(async () => {
    setLoadingAgents(true);
    setAgentError(null);
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
            }
          }
        `,
      });
      if (response.data.data && response.data.data.agents) {
         setAgents(response.data.data.agents);
      } else {
        throw new Error(response.data.errors?.[0]?.message || 'Failed to fetch agents or invalid data received.');
      }
    } catch (error: any) {
      console.error('Error fetching agents:', error);
      const message = error.response?.data?.errors?.[0]?.message || error.message || 'An unknown error occurred while fetching agents.';
      setAgentError(message);
      setAgents([]); // Clear agents on error
    } finally {
      setLoadingAgents(false);
    }
  }, []); // Empty dependency array means this function is created once

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]); // Fetch agents on initial mount

  return (
    <AgentContext.Provider value={{ selectedAgentId, setSelectedAgentId, agents, fetchAgents, loadingAgents, agentError }}>
      {children}
    </AgentContext.Provider>
  );
};

export const useAgent = () => {
  const context = useContext(AgentContext);
  if (context === undefined) {
    throw new Error('useAgent must be used within an AgentProvider');
  }
  return context;
};
