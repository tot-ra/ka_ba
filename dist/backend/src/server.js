"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createServer = createServer;
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const static_1 = __importDefault(require("@fastify/static"));
const path_1 = require("path");
function createServer() {
    const fastify = (0, fastify_1.default)({
        logger: true,
    });
    fastify.register(cors_1.default, {
        origin: '*'
    });
    fastify.register(static_1.default, {
        root: (0, path_1.join)(__dirname, '../../dist'),
        prefix: '/',
    });
    return fastify;
}
