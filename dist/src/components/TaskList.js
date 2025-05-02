"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const axios_1 = __importDefault(require("axios")); // Import axios
// Basic Modal Component (can be moved to a separate file later)
const Modal = ({ isOpen, onClose, title, children }) => {
    if (!isOpen)
        return null;
    return ((0, jsx_runtime_1.jsx)("div", { style: {
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)', display: 'flex',
            alignItems: 'center', justifyContent: 'center', zIndex: 1000
        }, children: (0, jsx_runtime_1.jsxs)("div", { style: {
                backgroundColor: 'white', padding: '20px', borderRadius: '5px',
                minWidth: '300px', maxWidth: '80%', maxHeight: '80%', overflowY: 'auto'
            }, children: [(0, jsx_runtime_1.jsx)("h2", { children: title }), (0, jsx_runtime_1.jsx)("button", { onClick: onClose, style: { position: 'absolute', top: '10px', right: '10px' }, children: "Close" }), (0, jsx_runtime_1.jsx)("div", { children: children })] }) }));
};
const TaskList = ({ agentId }) => {
    const [tasks, setTasks] = (0, react_1.useState)([]);
    const [loading, setLoading] = (0, react_1.useState)(false);
    const [error, setError] = (0, react_1.useState)(null);
    const [selectedTask, setSelectedTask] = (0, react_1.useState)(null);
    const [isModalOpen, setIsModalOpen] = (0, react_1.useState)(false);
    const [taskHistory, setTaskHistory] = (0, react_1.useState)(null);
    const [historyLoading, setHistoryLoading] = (0, react_1.useState)(false);
    const [historyError, setHistoryError] = (0, react_1.useState)(null);
    (0, react_1.useEffect)(() => {
        if (!agentId) {
            setTasks([]); // Clear tasks if no agent is selected
            return;
        }
        const fetchTasks = async () => {
            setLoading(true);
            setError(null);
            console.log(`Fetching tasks for agent: ${agentId}`);
            try {
                const graphqlQuery = {
                    query: `
            query ListTasks($agentId: ID!) {
              listTasks(agentId: $agentId) {
                id
                state
                input {
                  role
                  parts # Fetching parts as JSONObject
                }
                output {
                  role
                  parts
                }
                error
                createdAt
                updatedAt
                artifacts # Fetching artifacts map
              }
            }
          `,
                    variables: { agentId },
                };
                const response = await axios_1.default.post('http://localhost:3000/graphql', graphqlQuery);
                if (response.data.errors) {
                    // Handle GraphQL errors
                    console.error("GraphQL errors:", response.data.errors);
                    throw new Error(response.data.errors.map((e) => e.message).join(', '));
                }
                const data = response.data.data.listTasks;
                // Basic validation
                if (!Array.isArray(data)) {
                    console.error("Received non-array data from listTasks query:", data);
                    throw new Error('Invalid data format received from server.');
                }
                console.log(`Received ${data.length} tasks.`);
                setTasks(data);
            }
            catch (err) {
                console.error("Error fetching tasks:", err);
                setError(err instanceof Error ? err.message : 'An unknown error occurred');
                setTasks([]);
            }
            finally {
                setLoading(false);
            }
        };
        fetchTasks();
    }, [agentId]); // Re-fetch when agentId changes
    const handleViewHistory = async (task) => {
        setSelectedTask(task);
        setIsModalOpen(true);
        setHistoryLoading(true);
        setHistoryError(null);
        setTaskHistory(null); // Clear previous history
        try {
            // TODO: Implement actual API call to fetch full task history
            console.log(`Fetching history for task ${task.id}...`);
            // const response = await fetch(`/api/agents/${agentId}/tasks/${task.id}/history`);
            // if (!response.ok) {
            //   throw new Error('Failed to fetch task history');
            // }
            // const historyData: TaskHistory = await response.json();
            // Placeholder data for now
            await new Promise(resolve => setTimeout(resolve, 500)); // Simulate network delay
            const historyData = {
                messages: [
                    { role: 'user', content: 'Initial prompt (placeholder)', timestamp: task.createdAt }, // Use createdAt
                    { role: 'assistant', content: 'Assistant response (placeholder)', timestamp: task.updatedAt }, // Use updatedAt and static text
                    // Add more placeholder messages if needed
                ],
                artifacts: [
                // Add placeholder artifacts if needed
                // { name: 'output.txt', type: 'text/plain', uri: 'data:text/plain;base64,SGVsbG8gV29ybGQ=' }
                ],
            };
            setTaskHistory(historyData);
        }
        catch (err) {
            console.error("Error fetching task history:", err);
            setHistoryError(err instanceof Error ? err.message : 'An unknown error occurred');
        }
        finally {
            setHistoryLoading(false);
        }
    };
    const closeModal = () => {
        setIsModalOpen(false);
        setSelectedTask(null);
        setTaskHistory(null);
        setHistoryError(null);
    };
    if (!agentId) {
        return (0, jsx_runtime_1.jsx)("div", { children: "Select an agent to view tasks." });
    }
    if (loading) {
        return (0, jsx_runtime_1.jsx)("div", { children: "Loading tasks..." });
    }
    if (error) {
        return (0, jsx_runtime_1.jsxs)("div", { style: { color: 'red' }, children: ["Error loading tasks: ", error] });
    }
    // Helper to get first text part from input messages
    const getFirstInputText = (task) => {
        if (task.input && task.input.length > 0) {
            const firstMessage = task.input[0];
            if (firstMessage.parts && firstMessage.parts.length > 0) {
                // Find the first part that looks like a text part
                const textPart = firstMessage.parts.find(p => typeof p === 'object' && p !== null && p.type === 'text' && typeof p.text === 'string');
                if (textPart) {
                    return textPart.text.substring(0, 100) + (textPart.text.length > 100 ? '...' : ''); // Truncate long text
                }
            }
        }
        return 'N/A';
    };
    if (tasks.length === 0) {
        return (0, jsx_runtime_1.jsx)("div", { children: "No tasks found for this agent." });
    }
    return ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h3", { children: "Tasks" }), (0, jsx_runtime_1.jsx)("ul", { style: { listStyle: 'none', padding: 0 }, children: tasks.map(task => ((0, jsx_runtime_1.jsxs)("li", { style: { border: '1px solid #ccc', marginBottom: '10px', padding: '10px', borderRadius: '4px' }, children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: "ID:" }), " ", (0, jsx_runtime_1.jsx)("code", { style: { fontSize: '0.9em' }, children: task.id })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: "State:" }), " ", (0, jsx_runtime_1.jsx)("span", { style: { fontWeight: 'bold', color: task.state === 'FAILED' ? 'red' : (task.state === 'COMPLETED' ? 'green' : 'inherit') }, children: task.state })] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: "Created:" }), " ", new Date(task.createdAt).toLocaleString()] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: "Updated:" }), " ", new Date(task.updatedAt).toLocaleString()] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: "Input:" }), " ", (0, jsx_runtime_1.jsx)("i", { style: { color: '#555' }, children: getFirstInputText(task) })] }), task.error && (0, jsx_runtime_1.jsxs)("div", { style: { color: 'red' }, children: [(0, jsx_runtime_1.jsx)("strong", { children: "Error:" }), " ", task.error] }), (0, jsx_runtime_1.jsx)("button", { onClick: () => handleViewHistory(task), style: { marginTop: '5px' }, children: "View History (Placeholder)" })] }, task.id))) }), (0, jsx_runtime_1.jsxs)(Modal, { isOpen: isModalOpen, onClose: closeModal, title: `History for Task: ${selectedTask?.id}`, children: [historyLoading && (0, jsx_runtime_1.jsx)("div", { children: "Loading history..." }), historyError && (0, jsx_runtime_1.jsxs)("div", { style: { color: 'red' }, children: ["Error: ", historyError] }), taskHistory && ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h4", { children: "Messages" }), taskHistory.messages.length > 0 ? ((0, jsx_runtime_1.jsx)("ul", { style: { listStyle: 'none', padding: 0 }, children: taskHistory.messages.map((msg, index) => ((0, jsx_runtime_1.jsxs)("li", { style: { marginBottom: '10px', borderBottom: '1px dashed #eee', paddingBottom: '5px' }, children: [(0, jsx_runtime_1.jsx)("strong", { children: msg.role }), " (", new Date(msg.timestamp).toLocaleString(), "):", (0, jsx_runtime_1.jsx)("pre", { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '5px 0 0 10px' }, children: msg.content })] }, index))) })) : ((0, jsx_runtime_1.jsx)("div", { children: "No messages found." })), (0, jsx_runtime_1.jsx)("h4", { children: "Artifacts" }), taskHistory.artifacts.length > 0 ? ((0, jsx_runtime_1.jsx)("ul", { style: { listStyle: 'none', padding: 0 }, children: taskHistory.artifacts.map((art, index) => ((0, jsx_runtime_1.jsxs)("li", { children: [art.name, " (", art.type, ") - ", (0, jsx_runtime_1.jsx)("a", { href: art.uri, target: "_blank", rel: "noopener noreferrer", children: "View/Download" })] }, index))) })) : ((0, jsx_runtime_1.jsx)("div", { children: "No artifacts found." }))] }))] })] }));
};
exports.default = TaskList;
