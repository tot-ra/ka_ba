"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.schema = exports.schemaString = exports.JSONObjectResolver = void 0;
const fs_1 = require("fs");
const path_1 = require("path");
const graphql_1 = require("graphql");
exports.JSONObjectResolver = new graphql_1.GraphQLScalarType({
    name: 'JSONObject',
    description: 'A generic JSON object scalar type',
    serialize(value) {
        if (typeof value === 'object' && value !== null) {
            return value;
        }
        throw new Error('JSONObject cannot represent non-object value: ' + value);
    },
    parseValue(value) {
        if (typeof value === 'object' && value !== null) {
            return value;
        }
        throw new Error('JSONObject cannot represent non-object value: ' + value);
    },
    parseLiteral(ast) {
        if (ast.kind === graphql_1.Kind.OBJECT || ast.kind === graphql_1.Kind.LIST || ast.kind === graphql_1.Kind.STRING || ast.kind === graphql_1.Kind.INT || ast.kind === graphql_1.Kind.FLOAT || ast.kind === graphql_1.Kind.BOOLEAN || ast.kind === graphql_1.Kind.NULL) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return ast.value;
        }
        throw new Error('JSONObject cannot represent literal value: ' + ast);
    },
});
exports.schemaString = (0, fs_1.readFileSync)((0, path_1.join)(__dirname, '../schema.graphql'), 'utf8');
exports.schema = (0, graphql_1.buildSchema)(exports.schemaString);
