"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const react_1 = require("react");
const axios_1 = __importDefault(require("axios"));
const react_router_dom_1 = require("react-router-dom");
const AddExternalAgent_module_css_1 = __importDefault(require("./AddExternalAgent.module.css")); // Import the new CSS module
const AddExternalAgent = () => {
    const navigate = (0, react_router_dom_1.useNavigate)();
    const [newAgentUrl, setNewAgentUrl] = (0, react_1.useState)('');
    const [newAgentName, setNewAgentName] = (0, react_1.useState)('');
    const [isAddingExternal, setIsAddingExternal] = (0, react_1.useState)(false);
    const [addExternalStatusMessage, setAddExternalStatusMessage] = (0, react_1.useState)(null);
    const [addExternalMessageType, setAddExternalMessageType] = (0, react_1.useState)(null);
    const handleAddAgent = async (e) => {
        e.preventDefault();
        setIsAddingExternal(true);
        setAddExternalStatusMessage(null);
        setAddExternalMessageType(null);
        console.log('Attempting to add agent:', newAgentUrl, 'with name:', newAgentName);
        try {
            const response = await axios_1.default.post('http://localhost:3000/graphql', {
                query: `
          mutation AddAgent($url: String!, $name: String) {
            addAgent(url: $url, name: $name) {
              id
              url
              name
              description
              isLocal
            }
          }
        `,
                variables: {
                    url: newAgentUrl,
                    name: newAgentName || null,
                },
            });
            const newAgent = response.data.data.addAgent;
            if (newAgent && newAgent.id) {
                console.log('Agent added successfully:', newAgent);
                setAddExternalStatusMessage(`External agent "${newAgent.name || newAgent.id}" added successfully. Redirecting...`);
                setAddExternalMessageType('success');
                // Navigate back after a short delay
                setTimeout(() => navigate('/agents'), 1500);
            }
            else {
                const errorMessage = response.data.errors?.[0]?.message || 'Failed to add agent or received invalid data.';
                console.error('Failed to add agent:', newAgentUrl, newAgentName, response.data);
                setAddExternalStatusMessage(`Error: ${errorMessage}`);
                setAddExternalMessageType('error');
                setIsAddingExternal(false); // Stop loading on error
            }
        }
        catch (error) {
            console.error('Error adding agent:', error);
            const message = error.response?.data?.errors?.[0]?.message || error.message || 'An unknown error occurred.';
            setAddExternalStatusMessage(`Error: ${message}`);
            setAddExternalMessageType('error');
            setIsAddingExternal(false); // Stop loading on error
        }
        // Don't set isAddingExternal to false on success, as we are navigating away
    };
    // Helper to get alert class based on type
    const getAlertClass = (type) => {
        if (type === 'success')
            return AddExternalAgent_module_css_1.default.alertSuccess;
        if (type === 'error')
            return AddExternalAgent_module_css_1.default.alertError;
        return AddExternalAgent_module_css_1.default.alertInfo; // Default or null
    };
    return ((0, jsx_runtime_1.jsxs)("div", { className: AddExternalAgent_module_css_1.default.container, children: [(0, jsx_runtime_1.jsx)("button", { onClick: () => navigate('/agents'), className: `${AddExternalAgent_module_css_1.default.button} ${AddExternalAgent_module_css_1.default.buttonBack}`, children: "\u2190 Back to Agent Management" }), (0, jsx_runtime_1.jsxs)("div", { className: AddExternalAgent_module_css_1.default.paper, children: [(0, jsx_runtime_1.jsx)("h1", { className: AddExternalAgent_module_css_1.default.title, children: "Add External Agent" }), (0, jsx_runtime_1.jsx)("form", { onSubmit: handleAddAgent, className: AddExternalAgent_module_css_1.default.form, children: (0, jsx_runtime_1.jsxs)("div", { className: AddExternalAgent_module_css_1.default.formGrid, children: [(0, jsx_runtime_1.jsxs)("div", { className: `${AddExternalAgent_module_css_1.default.formField} ${AddExternalAgent_module_css_1.default.formFieldName}`, children: [(0, jsx_runtime_1.jsx)("label", { htmlFor: "externalAgentName", className: AddExternalAgent_module_css_1.default.formLabel, children: "Agent Name (Optional)" }), (0, jsx_runtime_1.jsx)("input", { type: "text", id: "externalAgentName", value: newAgentName, onChange: (e) => setNewAgentName(e.target.value), className: AddExternalAgent_module_css_1.default.formInput })] }), (0, jsx_runtime_1.jsxs)("div", { className: `${AddExternalAgent_module_css_1.default.formField} ${AddExternalAgent_module_css_1.default.formFieldUrl}`, children: [(0, jsx_runtime_1.jsx)("label", { htmlFor: "externalAgentUrl", className: AddExternalAgent_module_css_1.default.formLabel, children: "Agent URL" }), (0, jsx_runtime_1.jsx)("input", { type: "url" // Use type="url" for better semantics/validation
                                            , required: true, id: "externalAgentUrl", placeholder: "http://...", value: newAgentUrl, onChange: (e) => setNewAgentUrl(e.target.value), className: AddExternalAgent_module_css_1.default.formInput })] }), (0, jsx_runtime_1.jsxs)("div", { className: `${AddExternalAgent_module_css_1.default.formField} ${AddExternalAgent_module_css_1.default.formFieldButton}`, children: [(0, jsx_runtime_1.jsx)("label", { className: AddExternalAgent_module_css_1.default.formLabel, children: "\u00A0" }), (0, jsx_runtime_1.jsxs)("button", { type: "submit", className: `${AddExternalAgent_module_css_1.default.button} ${AddExternalAgent_module_css_1.default.buttonPrimary}`, disabled: isAddingExternal || !newAgentUrl, children: [isAddingExternal && (0, jsx_runtime_1.jsx)("div", { className: AddExternalAgent_module_css_1.default.spinner }), isAddingExternal ? 'Adding...' : 'Add Agent'] })] }), addExternalStatusMessage && ((0, jsx_runtime_1.jsx)("div", { className: `${AddExternalAgent_module_css_1.default.formField} ${AddExternalAgent_module_css_1.default.formFieldFull}`, children: (0, jsx_runtime_1.jsx)("div", { className: `${AddExternalAgent_module_css_1.default.alert} ${getAlertClass(addExternalMessageType)}`, children: addExternalStatusMessage }) }))] }) })] })] }));
};
exports.default = AddExternalAgent;
