"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.useAgent = exports.AgentProvider = void 0;
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const axios_1 = __importDefault(require("axios")); // Assuming axios is available
const AgentContext = (0, react_1.createContext)(undefined);
const AgentProvider = ({ children }) => {
    const [selectedAgentId, setSelectedAgentId] = (0, react_1.useState)(null);
    const [agents, setAgents] = (0, react_1.useState)([]);
    const [loadingAgents, setLoadingAgents] = (0, react_1.useState)(true);
    const [agentError, setAgentError] = (0, react_1.useState)(null);
    const fetchAgents = (0, react_1.useCallback)(async () => {
        setLoadingAgents(true);
        setAgentError(null);
        try {
            const response = await axios_1.default.post('http://localhost:3000/graphql', {
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
            }
            else {
                throw new Error(response.data.errors?.[0]?.message || 'Failed to fetch agents or invalid data received.');
            }
        }
        catch (error) {
            console.error('Error fetching agents:', error);
            const message = error.response?.data?.errors?.[0]?.message || error.message || 'An unknown error occurred while fetching agents.';
            setAgentError(message);
            setAgents([]); // Clear agents on error
        }
        finally {
            setLoadingAgents(false);
        }
    }, []); // Empty dependency array means this function is created once
    (0, react_1.useEffect)(() => {
        fetchAgents();
    }, [fetchAgents]); // Fetch agents on initial mount
    return ((0, jsx_runtime_1.jsx)(AgentContext.Provider, { value: { selectedAgentId, setSelectedAgentId, agents, fetchAgents, loadingAgents, agentError }, children: children }));
};
exports.AgentProvider = AgentProvider;
const useAgent = () => {
    const context = (0, react_1.useContext)(AgentContext);
    if (context === undefined) {
        throw new Error('useAgent must be used within an AgentProvider');
    }
    return context;
};
exports.useAgent = useAgent;
