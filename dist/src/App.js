"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const jsx_runtime_1 = require("react/jsx-runtime");
const react_router_dom_1 = require("react-router-dom");
const AgentManagement_1 = __importDefault(require("./pages/AgentManagement"));
const AddLocalAgent_1 = __importDefault(require("./pages/AddLocalAgent")); // Import the new local agent component
const AddExternalAgent_1 = __importDefault(require("./pages/AddExternalAgent")); // Import the new external agent component
// Removed OrchestrationManagement import
// Removed WorkflowDefinition import
require("./App.css"); // Assuming a basic App.css might be needed
const AgentContext_1 = require("./contexts/AgentContext");
function App() {
    return ((0, jsx_runtime_1.jsx)(AgentContext_1.AgentProvider, { children: (0, jsx_runtime_1.jsx)(react_router_dom_1.BrowserRouter, { children: (0, jsx_runtime_1.jsxs)("div", { children: [(0, jsx_runtime_1.jsx)("nav", { children: (0, jsx_runtime_1.jsx)("ul", { children: (0, jsx_runtime_1.jsx)("li", { children: (0, jsx_runtime_1.jsx)(react_router_dom_1.Link, { to: "/agents", children: "Agents" }) }) }) }), (0, jsx_runtime_1.jsxs)(react_router_dom_1.Routes, { children: [(0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/agents", element: (0, jsx_runtime_1.jsx)(AgentManagement_1.default, {}) }), (0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/add-local-agent", element: (0, jsx_runtime_1.jsx)(AddLocalAgent_1.default, {}) }), " ", (0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/add-external-agent", element: (0, jsx_runtime_1.jsx)(AddExternalAgent_1.default, {}) }), " ", (0, jsx_runtime_1.jsx)(react_router_dom_1.Route, { path: "/", element: (0, jsx_runtime_1.jsx)(AgentManagement_1.default, {}) }), " "] })] }) }) }));
}
exports.default = App;
