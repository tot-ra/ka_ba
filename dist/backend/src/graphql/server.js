"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.setupApolloServer = setupApolloServer;
const server_1 = require("@apollo/server");
const fastify_1 = __importStar(require("@as-integrations/fastify"));
const schema_1 = require("./schema");
const resolvers_1 = require("./resolvers");
// Removed orchestrator from function signature
async function setupApolloServer(fastify, agentManager) {
    // Updated call to createResolvers
    const resolvers = (0, resolvers_1.createResolvers)(agentManager);
    const apollo = new server_1.ApolloServer({
        typeDefs: schema_1.schemaString,
        resolvers,
        plugins: [(0, fastify_1.fastifyApolloDrainPlugin)(fastify)]
    });
    await apollo.start();
    await fastify.register((0, fastify_1.default)(apollo), {
        path: '/graphql',
        context: async (request, reply) => {
            return {
                request,
                reply,
                agentManager
                // Removed orchestrator from returned context
            };
        }
    });
    console.log('Apollo Server registered at /graphql');
}
