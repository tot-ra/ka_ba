import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import '../App.css'; // Assuming App.css contains the navigation styles

function Navigation() {
  const location = useLocation();

  return (
    <nav>
      <h1>🙌🏻 ka_ba 🦚</h1>
      <ul>
        <li className={location.pathname === '/agents' || location.pathname.startsWith('/agents/') ? 'active-link' : ''}>
          <Link to="/agents">Agents</Link>
        </li>
        <li className={location.pathname === '/mcp' || location.pathname.startsWith('/mcp/') ? 'active-link' : ''}>
          <Link to="/mcp">MCP servers</Link>
        </li>
      </ul>
    </nav>
  );
}

export default Navigation;
