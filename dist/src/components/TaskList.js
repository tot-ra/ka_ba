"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
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
            try {
                // TODO: Replace with actual API call to the 'ba' backend
                // Call the actual backend API endpoint
                const response = await fetch(`/api/agents/${agentId}/tasks`);
                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({ message: 'Failed to fetch tasks and parse error response' }));
                    throw new Error(errorData.message || `HTTP error! status: ${response.status}`);
                }
                const data = await response.json(); // Assuming the backend returns Task[] directly
                // Validate the structure of the received data (basic check)
                if (!Array.isArray(data)) {
                    console.error("Received non-array data from task list endpoint:", data);
                    throw new Error('Invalid data format received from server.');
                }
                // Optional: Add more detailed validation for each task object if needed
                setTasks(data);
            }
            catch (err) {
                console.error("Error fetching tasks:", err); // Log the actual error
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
                    { role: 'user', content: 'Initial prompt', timestamp: new Date().toISOString() },
                    { role: 'assistant', content: task.lastMessage, timestamp: task.updatedAt },
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
    if (tasks.length === 0) {
        return (0, jsx_runtime_1.jsx)("div", { children: "No tasks found for this agent." });
    }
    return ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h3", { children: "Tasks" }), (0, jsx_runtime_1.jsx)("ul", { style: { listStyle: 'none', padding: 0 }, children: tasks.map(task => ((0, jsx_runtime_1.jsxs)("li", { style: { border: '1px solid #ccc', marginBottom: '10px', padding: '10px' }, children: [(0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: "ID:" }), " ", task.id] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: "Status:" }), " ", task.status] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: "Last Update:" }), " ", new Date(task.updatedAt).toLocaleString()] }), (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("strong", { children: "Last Message:" }), " ", task.lastMessage] }), (0, jsx_runtime_1.jsx)("button", { onClick: () => handleViewHistory(task), style: { marginTop: '5px' }, children: "View History" })] }, task.id))) }), (0, jsx_runtime_1.jsxs)(Modal, { isOpen: isModalOpen, onClose: closeModal, title: `History for Task: ${selectedTask?.id}`, children: [historyLoading && (0, jsx_runtime_1.jsx)("div", { children: "Loading history..." }), historyError && (0, jsx_runtime_1.jsxs)("div", { style: { color: 'red' }, children: ["Error: ", historyError] }), taskHistory && ((0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("h4", { children: "Messages" }), taskHistory.messages.length > 0 ? ((0, jsx_runtime_1.jsx)("ul", { style: { listStyle: 'none', padding: 0 }, children: taskHistory.messages.map((msg, index) => ((0, jsx_runtime_1.jsxs)("li", { style: { marginBottom: '10px', borderBottom: '1px dashed #eee', paddingBottom: '5px' }, children: [(0, jsx_runtime_1.jsx)("strong", { children: msg.role }), " (", new Date(msg.timestamp).toLocaleString(), "):", (0, jsx_runtime_1.jsx)("pre", { style: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: '5px 0 0 10px' }, children: msg.content })] }, index))) })) : ((0, jsx_runtime_1.jsx)("div", { children: "No messages found." })), (0, jsx_runtime_1.jsx)("h4", { children: "Artifacts" }), taskHistory.artifacts.length > 0 ? ((0, jsx_runtime_1.jsx)("ul", { style: { listStyle: 'none', padding: 0 }, children: taskHistory.artifacts.map((art, index) => ((0, jsx_runtime_1.jsxs)("li", { children: [art.name, " (", art.type, ") - ", (0, jsx_runtime_1.jsx)("a", { href: art.uri, target: "_blank", rel: "noopener noreferrer", children: "View/Download" })] }, index))) })) : ((0, jsx_runtime_1.jsx)("div", { children: "No artifacts found." }))] }))] })] }));
};
exports.default = TaskList;
