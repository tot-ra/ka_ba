import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import AgentManagement from './pages/AgentManagement';
import AddAgent from './pages/AddAgent'; // Import the new AddAgent component
// Removed OrchestrationManagement import
// Removed WorkflowDefinition import
import './App.css'; // Assuming a basic App.css might be needed
import { AgentProvider } from './contexts/AgentContext';

function App() {
  return (
    <AgentProvider>
      <Router>
        <div>


          <nav>
            <ul>
              <li>
                <Link to="/agents">Agents</Link>
              </li>
              {/* Removed Orchestration link */}
              {/* Removed Define Workflow link */}
              {/* Add other navigation links here */}
            </ul>
          </nav>

          <Routes>
            <Route path="/agents" element={<AgentManagement />} />
            <Route path="/add-agent" element={<AddAgent />} /> {/* Add route for AddAgent */}
            {/* Removed Orchestration route */}
            {/* Removed Define Workflow route */}
            {/* Add other routes here */}
            <Route path="/" element={<AgentManagement />} /> {/* Default to Agent Management */}
          </Routes>
        </div>
      </Router>
    </AgentProvider>
  );
}

export default App;
