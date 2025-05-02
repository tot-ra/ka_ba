"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const axios_1 = __importDefault(require("axios")); // Assuming axios is used for HTTP requests
const TaskList_1 = __importDefault(require("../components/TaskList")); // Import the TaskList component
const TaskSubmitForm_1 = __importDefault(require("../components/TaskSubmitForm")); // Import the new TaskSubmitForm component
const react_router_dom_1 = require("react-router-dom");
const AgentManagement_module_css_1 = __importDefault(require("./AgentManagement.module.css")); // Import the CSS module
const AgentManagement = () => {
    const navigate = (0, react_router_dom_1.useNavigate)();
    const [agents, setAgents] = (0, react_1.useState)([]);
    const [selectedAgentId, setSelectedAgentId] = (0, react_1.useState)(null);
    const [agentLogs, setAgentLogs] = (0, react_1.useState)([]); // State for logs
    const [loadingLogs, setLoadingLogs] = (0, react_1.useState)(false); // State for loading logs indicator
    (0, react_1.useEffect)(() => {
        // Fetch agents from backend on component mount
        const fetchAgents = async () => {
            try {
                // Assuming a GraphQL endpoint at /graphql
                const response = await axios_1.default.post('http://localhost:3000/graphql', {
                    query: `
            query {
              agents {
                id
                url
                name
                description
                isLocal
                pid # Fetch pid
              }
            }
          `,
                });
                setAgents(response.data.data.agents);
            }
            catch (error) {
                console.error('Error fetching agents:', error);
            }
        };
        fetchAgents();
    }, []);
    // Function to fetch logs for the selected agent
    const fetchAgentLogs = async (agentId) => {
        setLoadingLogs(true);
        setAgentLogs([]); // Clear previous logs
        try {
            const response = await axios_1.default.post('http://localhost:3000/graphql', {
                query: `
          query GetAgentLogs($agentId: ID!) {
            agentLogs(agentId: $agentId)
          }
        `,
                variables: { agentId },
            });
            if (response.data.data.agentLogs) {
                setAgentLogs(response.data.data.agentLogs);
            }
            else {
                setAgentLogs(['No logs available or agent not found.']); // Provide feedback
            }
        }
        catch (error) {
            console.error('Error fetching agent logs:', error);
            setAgentLogs(['Error fetching logs.']); // Provide error feedback
        }
        finally {
            setLoadingLogs(false);
        }
    };
    const handleSelectAgent = (agentId) => {
        setSelectedAgentId(agentId);
        console.log('Selected agent:', agentId);
        // Fetch logs when an agent is selected
        fetchAgentLogs(agentId);
    };
    const handleStopAgent = async (agentId) => {
        console.log('Attempting to stop agent:', agentId);
        try {
            const response = await axios_1.default.post('http://localhost:3000/graphql', {
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
            }
            else {
                console.error('Failed to stop agent:', agentId);
            }
        }
        catch (error) {
            console.error('Error stopping agent:', error);
        }
    };
    return ((0, jsx_runtime_1.jsxs)("div", { className: AgentManagement_module_css_1.default.container, children: [(0, jsx_runtime_1.jsx)("h1", { className: AgentManagement_module_css_1.default.title, children: "Agents" }), (0, jsx_runtime_1.jsxs)("div", { className: AgentManagement_module_css_1.default.buttonContainer, children: [(0, jsx_runtime_1.jsx)("button", { className: `${AgentManagement_module_css_1.default.button} ${AgentManagement_module_css_1.default.buttonPrimary}`, onClick: () => navigate('/add-local-agent'), children: "Spawn Local Agent" }), (0, jsx_runtime_1.jsx)("button", { className: `${AgentManagement_module_css_1.default.button} ${AgentManagement_module_css_1.default.buttonSecondary}`, onClick: () => navigate('/add-external-agent'), children: "Add External Agent" })] }), (0, jsx_runtime_1.jsxs)("div", { className: AgentManagement_module_css_1.default.agentListContainer, children: [(0, jsx_runtime_1.jsx)("ul", { className: AgentManagement_module_css_1.default.agentList, children: agents.map(agent => ((0, jsx_runtime_1.jsxs)("li", { className: `${AgentManagement_module_css_1.default.agentListItem} ${selectedAgentId === agent.id ? AgentManagement_module_css_1.default.agentListItemSelected : ''}`, children: [(0, jsx_runtime_1.jsxs)("div", { className: AgentManagement_module_css_1.default.agentInfo, children: [(0, jsx_runtime_1.jsx)("input", { type: "radio", id: `agent-${agent.id}`, name: "selectedAgent", value: agent.id, checked: selectedAgentId === agent.id, onChange: () => handleSelectAgent(agent.id), className: AgentManagement_module_css_1.default.agentRadio }), (0, jsx_runtime_1.jsxs)("label", { htmlFor: `agent-${agent.id}`, className: AgentManagement_module_css_1.default.agentLabel, children: [(0, jsx_runtime_1.jsxs)("div", { className: AgentManagement_module_css_1.default.agentNameContainer, children: [(0, jsx_runtime_1.jsx)("a", { href: agent.url + '/.well-known/agent.json', target: "_blank", rel: "noopener noreferrer", className: AgentManagement_module_css_1.default.agentNameLink, children: agent.name || 'Unnamed Agent' }), (0, jsx_runtime_1.jsxs)("span", { className: AgentManagement_module_css_1.default.agentUrl, children: ["(", agent.url, ")"] }), " ", agent.isLocal && agent.pid && (0, jsx_runtime_1.jsxs)("span", { className: AgentManagement_module_css_1.default.agentPid, children: [" (PID: ", agent.pid, ")"] }), " "] }), agent.description && (0, jsx_runtime_1.jsx)("div", { className: AgentManagement_module_css_1.default.agentDescription, children: agent.description })] })] }), agent.isLocal && ((0, jsx_runtime_1.jsx)("button", { onClick: () => handleStopAgent(agent.id), className: AgentManagement_module_css_1.default.buttonDanger, children: "Stop" }))] }, agent.id))) }), selectedAgentId && ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [" ", (0, jsx_runtime_1.jsx)("div", { className: AgentManagement_module_css_1.default.taskListSection, children: (0, jsx_runtime_1.jsx)(TaskList_1.default, { agentId: selectedAgentId }) }), (0, jsx_runtime_1.jsxs)("div", { className: AgentManagement_module_css_1.default.logsSection, children: [(0, jsx_runtime_1.jsx)("h3", { className: AgentManagement_module_css_1.default.logsTitle, children: "Agent Logs" }), loadingLogs ? ((0, jsx_runtime_1.jsx)("p", { children: "Loading logs..." })) : ((0, jsx_runtime_1.jsx)("pre", { className: AgentManagement_module_css_1.default.logsContent, children: agentLogs.length > 0 ? agentLogs.join('\n') : 'No logs to display.' }))] })] }) /* End of Fragment */)] }), selectedAgentId && ((0, jsx_runtime_1.jsx)(TaskSubmitForm_1.default, { agentId: selectedAgentId }))] }));
};
exports.default = AgentManagement;
