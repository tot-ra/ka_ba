"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const axios_1 = __importDefault(require("axios"));
const TaskSubmitForm = ({ agentId }) => {
    const [prompt, setPrompt] = (0, react_1.useState)('');
    const [isSubmitting, setIsSubmitting] = (0, react_1.useState)(false);
    const [submitStatus, setSubmitStatus] = (0, react_1.useState)(null);
    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!prompt.trim()) {
            setSubmitStatus({ type: 'error', message: 'Prompt cannot be empty.' });
            return;
        }
        setIsSubmitting(true);
        setSubmitStatus(null);
        const payload = {
            message: {
                role: 'user',
                parts: [{ type: 'text', text: prompt }],
            },
            agentId: agentId, // Include the agentId in the payload
        };
        try {
            // Assuming the backend endpoint /api/tasks/create can handle the agentId
            const response = await axios_1.default.post('/api/tasks/create', payload);
            if (response.status === 200 && response.data && response.data.id) {
                setSubmitStatus({
                    type: 'success',
                    message: `Task ${response.data.id} created and assigned to agent ${response.data.assignedAgentId}. Status: ${response.data.status.state}`,
                });
                setPrompt(''); // Clear prompt on success
            }
            else {
                // Handle cases where API returns 200 but data is unexpected
                console.error('Unexpected success response:', response);
                setSubmitStatus({ type: 'error', message: 'Received an unexpected response from the server.' });
            }
        }
        catch (error) {
            console.error('Error submitting task:', error);
            const errorMessage = error.response?.data?.error || error.message || 'An unknown error occurred.';
            setSubmitStatus({ type: 'error', message: `Error: ${errorMessage}` });
        }
        finally {
            setIsSubmitting(false);
        }
    };
    return ((0, jsx_runtime_1.jsxs)("div", { style: { marginTop: '20px', padding: '15px', border: '1px solid #eee', borderRadius: '4px' }, children: [(0, jsx_runtime_1.jsx)("h3", { children: "Submit New Task" }), (0, jsx_runtime_1.jsxs)("form", { onSubmit: handleSubmit, children: [(0, jsx_runtime_1.jsx)("textarea", { value: prompt, onChange: (e) => setPrompt(e.target.value), placeholder: "Enter task prompt...", rows: 4, style: { width: '100%', padding: '8px', marginBottom: '10px', borderRadius: '4px', border: '1px solid #ddd' }, disabled: isSubmitting }), (0, jsx_runtime_1.jsx)("button", { type: "submit", disabled: isSubmitting, style: {
                            padding: '10px 15px',
                            backgroundColor: isSubmitting ? '#6c757d' : '#007bff',
                            color: 'white',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                        }, children: isSubmitting ? 'Submitting...' : 'Submit Task' })] }), submitStatus && ((0, jsx_runtime_1.jsx)("div", { style: {
                    marginTop: '10px',
                    padding: '10px',
                    borderRadius: '4px',
                    backgroundColor: submitStatus.type === 'success' ? '#d4edda' : '#f8d7da',
                    color: submitStatus.type === 'success' ? '#155724' : '#721c24',
                    border: `1px solid ${submitStatus.type === 'success' ? '#c3e6cb' : '#f5c6cb'}`,
                }, children: submitStatus.message }))] }));
};
exports.default = TaskSubmitForm;
