import React from 'react';
import { BrowserRouter as Router, Route, Routes, Link } from 'react-router-dom';
import AgentManagement from './pages/AgentManagement';
import AddLocalAgent from './pages/AddLocalAgent'; // Import the new local agent component
import AddExternalAgent from './pages/AddExternalAgent'; // Import the new external agent component
import EditLocalAgent from './pages/EditLocalAgent'; // Import the new edit local agent component
import AgentInteraction from './pages/AgentInteraction'; // Import the AgentInteraction component
// Removed OrchestrationManagement import
// Removed WorkflowDefinition import
import './App.css'; // Assuming a basic App.css might be needed
import { AgentProvider } from './contexts/AgentContext';

function App() {
  return (
    <AgentProvider>
      <Router>
        <div>

          <nav style={{display:'flex', justifyContent:'space-between', padding:'0px 20px', backgroundColor:'#f0f0f0'}}>
            <h1>🦚 BA</h1>

            <ul  style={{ flexGrow: 1, marginLeft: '20px'}}>

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
            <Route path="/agents/edit/:agentId" element={<EditLocalAgent />} /> {/* Route for editing local agent */}
            <Route path="/agent/view/:agentId" element={<AgentManagement />}> {/* Route for viewing agent tasks */}
              <Route path="task/:taskId" element={<AgentManagement />} /> {/* Nested route for viewing specific task chat details */}
            </Route>
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
