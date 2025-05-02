"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react"); // Import useEffect
const axios_1 = __importDefault(require("axios"));
const react_router_dom_1 = require("react-router-dom");
const AddLocalAgent_module_css_1 = __importDefault(require("./AddLocalAgent.module.css")); // Import CSS module
const AddLocalAgent = () => {
    const navigate = (0, react_router_dom_1.useNavigate)();
    const [spawnAgentConfig, setSpawnAgentConfig] = (0, react_1.useState)({
        model: 'qwen3-30b-a3b',
        systemPrompt: 'You are an expert software engineer.',
        apiBaseUrl: 'http://localhost:1234',
        port: '',
        name: 'Software Engineer',
        description: 'An AI assistant specialized in software engineering tasks.',
    });
    const [showAdvanced, setShowAdvanced] = (0, react_1.useState)(false);
    const [isSpawning, setIsSpawning] = (0, react_1.useState)(false);
    const [spawnStatusMessage, setSpawnStatusMessage] = (0, react_1.useState)(null);
    const [spawnMessageType, setSpawnMessageType] = (0, react_1.useState)(null);
    const [spawnedAgentId, setSpawnedAgentId] = (0, react_1.useState)(null); // State for agent ID
    const [agentLogs, setAgentLogs] = (0, react_1.useState)([]); // State for logs
    const [isFetchingLogs, setIsFetchingLogs] = (0, react_1.useState)(false); // State for log fetching status
    const handleSpawnAgent = async (e) => {
        e.preventDefault();
        setIsSpawning(true);
        setSpawnStatusMessage(null);
        setSpawnMessageType(null);
        console.log('Attempting to spawn agent with config:', spawnAgentConfig);
        const variables = {
            ...spawnAgentConfig,
            port: spawnAgentConfig.port ? parseInt(spawnAgentConfig.port.toString(), 10) : null,
            name: spawnAgentConfig.name || null,
            description: spawnAgentConfig.description || null,
        };
        console.log('Variables being sent:', variables);
        try {
            const response = await axios_1.default.post('http://localhost:3000/graphql', {
                query: `
          mutation SpawnKaAgent($model: String, $systemPrompt: String, $apiBaseUrl: String, $port: Int, $name: String, $description: String) {
            spawnKaAgent(model: $model, systemPrompt: $systemPrompt, apiBaseUrl: $apiBaseUrl, port: $port, name: $name, description: $description) {
              id
              url
              name
              description
              isLocal
            }
          }
        `,
                variables: variables,
            });
            const spawnedAgent = response.data.data.spawnKaAgent;
            if (spawnedAgent && spawnedAgent.id) {
                console.log('Agent spawned successfully:', spawnedAgent);
                setSpawnedAgentId(spawnedAgent.id); // Store the ID
                setSpawnStatusMessage(`Agent "${spawnedAgent.name || spawnedAgent.id}" spawned successfully at ${spawnedAgent.url}. Fetching initial logs...`);
                setSpawnMessageType('success');
                setIsSpawning(false); // Stop initial spawning indicator
                setIsFetchingLogs(true); // Start log fetching indicator
                // Fetch logs using GraphQL
                try {
                    const logResponse = await axios_1.default.post('http://localhost:3000/graphql', {
                        query: `
              query AgentLogs($agentId: ID!) {
                agentLogs(agentId: $agentId)
              }
            `,
                        variables: { agentId: spawnedAgent.id },
                    });
                    const logs = logResponse.data.data.agentLogs;
                    if (logs) {
                        setAgentLogs(logs);
                        setSpawnStatusMessage(`Agent "${spawnedAgent.name || spawnedAgent.id}" spawned successfully at ${spawnedAgent.url}. Logs retrieved.`); // Update status
                    }
                    else {
                        // Handle case where logs might be null (e.g., agent stopped quickly)
                        console.warn(`Received null logs for agent ${spawnedAgent.id}.`);
                        setAgentLogs([]); // Set to empty array
                        setSpawnStatusMessage(`Agent "${spawnedAgent.name || spawnedAgent.id}" spawned successfully at ${spawnedAgent.url}. No logs available yet.`);
                    }
                }
                catch (logError) {
                    const errorMessage = logError.response?.data?.errors?.[0]?.message || logError.message || 'Unknown error fetching logs.';
                    console.error(`Error fetching logs for agent ${spawnedAgent.id}:`, errorMessage);
                    setSpawnStatusMessage(`Agent spawned, but failed to fetch logs: ${logError.message}`);
                    setSpawnMessageType('error'); // Show error for log fetching failure
                }
                finally {
                    setIsFetchingLogs(false); // Stop log fetching indicator
                }
            }
            else {
                const errorMessage = response.data.errors?.[0]?.message || 'Failed to spawn agent or received invalid data.';
                console.error('Failed to spawn agent:', spawnAgentConfig, response.data);
                setSpawnStatusMessage(`Error: ${errorMessage}`);
                setSpawnMessageType('error');
                setIsSpawning(false); // Stop loading on error
            }
        }
        catch (error) {
            console.error('Error spawning agent:', error);
            const message = error.response?.data?.errors?.[0]?.message || error.message || 'An unknown error occurred.';
            setSpawnStatusMessage(`Error: ${message}`);
            setSpawnMessageType('error');
            setIsSpawning(false); // Stop loading on spawn error
        }
        // Keep isSpawning false unless actively spawning or fetching logs
    };
    return ((0, jsx_runtime_1.jsx)("div", { className: AddLocalAgent_module_css_1.default.container, children: (0, jsx_runtime_1.jsxs)("div", { className: AddLocalAgent_module_css_1.default.paper, children: [(0, jsx_runtime_1.jsx)("h1", { className: AddLocalAgent_module_css_1.default.title, children: "Spawn Local 'ka' Agent" }), (0, jsx_runtime_1.jsx)("form", { onSubmit: handleSpawnAgent, className: AddLocalAgent_module_css_1.default.form, children: (0, jsx_runtime_1.jsxs)("div", { className: AddLocalAgent_module_css_1.default.formGrid, children: [(0, jsx_runtime_1.jsxs)("div", { className: AddLocalAgent_module_css_1.default.formField, children: [(0, jsx_runtime_1.jsx)("label", { htmlFor: "spawnName", className: AddLocalAgent_module_css_1.default.formLabel, children: "Agent Name (Optional)" }), (0, jsx_runtime_1.jsx)("input", { type: "text", id: "spawnName", name: "name", placeholder: "Coder Assistant", value: spawnAgentConfig.name, onChange: (e) => setSpawnAgentConfig({ ...spawnAgentConfig, name: e.target.value }), className: AddLocalAgent_module_css_1.default.formInput })] }), (0, jsx_runtime_1.jsxs)("div", { className: AddLocalAgent_module_css_1.default.formField, children: [(0, jsx_runtime_1.jsx)("label", { htmlFor: "spawnDescription", className: AddLocalAgent_module_css_1.default.formLabel, children: "Agent Description (Optional)" }), (0, jsx_runtime_1.jsx)("textarea", { id: "spawnDescription", name: "description", placeholder: "Describe the agent's purpose or specialization", value: spawnAgentConfig.description, onChange: (e) => setSpawnAgentConfig({ ...spawnAgentConfig, description: e.target.value }), rows: 16, className: AddLocalAgent_module_css_1.default.formTextarea })] }), (0, jsx_runtime_1.jsxs)("div", { className: AddLocalAgent_module_css_1.default.formField, children: [(0, jsx_runtime_1.jsx)("label", { htmlFor: "systemPrompt", className: AddLocalAgent_module_css_1.default.formLabel, children: "System Prompt" }), (0, jsx_runtime_1.jsx)("textarea", { id: "systemPrompt", name: "systemPrompt", value: spawnAgentConfig.systemPrompt, onChange: (e) => setSpawnAgentConfig({ ...spawnAgentConfig, systemPrompt: e.target.value }), rows: 8, className: AddLocalAgent_module_css_1.default.formTextarea }), (0, jsx_runtime_1.jsx)("p", { className: AddLocalAgent_module_css_1.default.captionText, children: "Note: This prompt will be injected into every task sent to this agent." })] }), (0, jsx_runtime_1.jsx)("div", { className: AddLocalAgent_module_css_1.default.checkboxGroup, children: (0, jsx_runtime_1.jsxs)("label", { htmlFor: "showAdvanced", className: AddLocalAgent_module_css_1.default.checkboxLabel, children: [(0, jsx_runtime_1.jsx)("input", { type: "checkbox", id: "showAdvanced", checked: showAdvanced, onChange: (e) => setShowAdvanced(e.target.checked), className: AddLocalAgent_module_css_1.default.checkboxInput }), "Show Advanced Properties"] }) }), showAdvanced && ((0, jsx_runtime_1.jsxs)(jsx_runtime_1.Fragment, { children: [(0, jsx_runtime_1.jsxs)("div", { className: AddLocalAgent_module_css_1.default.formField, children: [(0, jsx_runtime_1.jsx)("label", { htmlFor: "model", className: AddLocalAgent_module_css_1.default.formLabel, children: "LLM Model" }), (0, jsx_runtime_1.jsx)("input", { type: "text", id: "model", name: "model", value: spawnAgentConfig.model, onChange: (e) => setSpawnAgentConfig({ ...spawnAgentConfig, model: e.target.value }), className: AddLocalAgent_module_css_1.default.formInput })] }), (0, jsx_runtime_1.jsxs)("div", { className: AddLocalAgent_module_css_1.default.formField, children: [(0, jsx_runtime_1.jsx)("label", { htmlFor: "apiBaseUrl", className: AddLocalAgent_module_css_1.default.formLabel, children: "API Base URL" }), (0, jsx_runtime_1.jsx)("input", { type: "text", id: "apiBaseUrl", name: "apiBaseUrl", value: spawnAgentConfig.apiBaseUrl, onChange: (e) => setSpawnAgentConfig({ ...spawnAgentConfig, apiBaseUrl: e.target.value }), className: AddLocalAgent_module_css_1.default.formInput })] }), (0, jsx_runtime_1.jsxs)("div", { className: AddLocalAgent_module_css_1.default.formField, children: [(0, jsx_runtime_1.jsx)("label", { htmlFor: "port", className: AddLocalAgent_module_css_1.default.formLabel, children: "Agent Port (leave empty for random)" }), (0, jsx_runtime_1.jsx)("input", { type: "text" // Keep as text to allow empty string, validation handles number conversion
                                                , id: "port", name: "port", placeholder: "e.g., 8081", value: spawnAgentConfig.port, onChange: (e) => {
                                                    const value = e.target.value;
                                                    // Allow only digits or empty string
                                                    if (value === '' || /^\d*$/.test(value)) {
                                                        setSpawnAgentConfig({ ...spawnAgentConfig, port: value });
                                                    }
                                                }, className: AddLocalAgent_module_css_1.default.formInput })] })] })), spawnStatusMessage && ((0, jsx_runtime_1.jsx)("div", { className: `${AddLocalAgent_module_css_1.default.alert} ${spawnMessageType === 'success' ? AddLocalAgent_module_css_1.default.alertSuccess : spawnMessageType === 'error' ? AddLocalAgent_module_css_1.default.alertError : AddLocalAgent_module_css_1.default.alertInfo}`, children: spawnStatusMessage })), (0, jsx_runtime_1.jsx)("div", { className: AddLocalAgent_module_css_1.default.formField, children: (0, jsx_runtime_1.jsxs)("button", { type: "submit", className: `${AddLocalAgent_module_css_1.default.button} ${AddLocalAgent_module_css_1.default.buttonPrimary}`, disabled: isSpawning, children: [isSpawning && (0, jsx_runtime_1.jsx)("div", { className: AddLocalAgent_module_css_1.default.spinner }), isSpawning ? 'Spawning...' : 'Spawn Agent'] }) })] }) }), spawnedAgentId && agentLogs.length > 0 && ((0, jsx_runtime_1.jsxs)("div", { className: AddLocalAgent_module_css_1.default.logContainer, children: [(0, jsx_runtime_1.jsx)("h2", { className: AddLocalAgent_module_css_1.default.logTitle, children: "Agent Logs (Last 100 lines)" }), (0, jsx_runtime_1.jsx)("pre", { className: AddLocalAgent_module_css_1.default.logPre, children: agentLogs.map((log, index) => ((0, jsx_runtime_1.jsx)("div", { children: log }, index))) }), (0, jsx_runtime_1.jsx)("button", { onClick: () => navigate('/agents'), className: `${AddLocalAgent_module_css_1.default.button} ${AddLocalAgent_module_css_1.default.buttonSecondary}`, style: { marginTop: '1rem' }, children: "Go Back to Agent List" })] })), isFetchingLogs && ((0, jsx_runtime_1.jsxs)("div", { className: AddLocalAgent_module_css_1.default.spinnerContainer, children: [(0, jsx_runtime_1.jsx)("div", { className: AddLocalAgent_module_css_1.default.spinner }), (0, jsx_runtime_1.jsx)("p", { children: "Fetching logs..." })] }))] }) }));
};
exports.default = AddLocalAgent;
