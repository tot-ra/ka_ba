import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import AgentManagement from './pages/AgentManagement';
import AddLocalAgent from './pages/AddLocalAgent'; // Import the new local agent component
import AddExternalAgent from './pages/AddExternalAgent'; // Import the new external agent component
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
            <Route path="/add-local-agent" element={<AddLocalAgent />} /> {/* Route for adding local agent */}
            <Route path="/add-external-agent" element={<AddExternalAgent />} /> {/* Route for adding external agent */}
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
