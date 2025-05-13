import React from 'react';
import { BrowserRouter as Router, Route, Routes } from 'react-router-dom';
import Navigation from './components/Navigation';
import AgentManagement from './pages/AgentManagement';
import AddLocalAgent from './pages/AddLocalAgent'; // Import the new local agent component
import AddExternalAgent from './pages/AddExternalAgent'; // Import the new external agent component
import EditLocalAgent from './pages/EditLocalAgent'; // Import the new edit local agent component
import AgentInteraction from './pages/AgentInteraction'; // Import the AgentInteraction component
import ListMCP from './pages/ListMCP'; // Import the ListMCP component
import AddMcpServer from './pages/AddMcpServer'; // Import the AddMcpServer component
import EditMcpServer from './pages/EditMcpServer'; // Import the EditMcpServer component
// Removed OrchestrationManagement import
// Removed WorkflowDefinition import
import './App.css'; // Assuming a basic App.css might be needed
import { AgentProvider } from './contexts/AgentContext';

function App() {
  return (
    <AgentProvider>
      <Router>
        <div>
          <Navigation />
          <Routes>
            <Route path="/agents" element={<AgentManagement />} />
            <Route path="/mcp" element={<ListMCP />} />
            <Route path="/mcp/add" element={<AddMcpServer />} /> {/* Add route for adding MCP server */}
            <Route path="/mcp/edit/:name" element={<EditMcpServer />} /> {/* Add route for editing MCP server */}
            <Route path="/add-local-agent" element={<AddLocalAgent />} />
            <Route path="/add-external-agent" element={<AddExternalAgent />} />
            <Route path="/agents/edit/:agentId" element={<EditLocalAgent />} />
            <Route path="/agents/view/:agentId" element={<AgentManagement />}>
              <Route path="task/:taskId" element={<AgentManagement />} />
            </Route>
            <Route path="/" element={<AgentManagement />} />
          </Routes>
        </div>
      </Router>
    </AgentProvider>
  );
}

export default App;
