import React, { createContext, useState, useContext, ReactNode } from 'react';

interface AgentContextType {
  selectedAgentId: string | null;
  setSelectedAgentId: (id: string | null) => void;
}

const AgentContext = createContext<AgentContextType | undefined>(undefined);

export const AgentProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  return (
    <AgentContext.Provider value={{ selectedAgentId, setSelectedAgentId }}>
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
