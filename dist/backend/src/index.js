"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const server_1 = require("./server");
const agentManager_1 = require("./services/agentManager");
// Removed Orchestrator import
const proxy_1 = require("./routes/proxy");
const tasks_1 = require("./routes/tasks");
const server_2 = require("./graphql/server");
const start = async () => {
    // Removed orchestrator instantiation
    // Updated AgentManager instantiation (no args)
    const agentManager = new agentManager_1.AgentManager();
    const fastify = (0, server_1.createServer)();
    (0, proxy_1.registerProxyRoutes)(fastify, agentManager);
    (0, tasks_1.registerTasksRoutes)(fastify, agentManager);
    // Updated setupApolloServer call (removed orchestrator)
    await (0, server_2.setupApolloServer)(fastify, agentManager);
    try {
        await fastify.listen({ port: 3000 });
        console.log('Backend server listening on http://localhost:3000/graphql');
        console.log('Serving frontend from http://localhost:3000/');
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
