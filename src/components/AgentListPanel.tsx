import React from 'react';
import styles from './AgentListPanel.module.css';

interface AgentListPanelProps {
  children: React.ReactNode;
}

const AgentListPanel: React.FC<AgentListPanelProps> = ({ children }) => {
  return (
    <div className={styles.agentListPane}>
      {children}
    </div>
  );
};

export default AgentListPanel;
