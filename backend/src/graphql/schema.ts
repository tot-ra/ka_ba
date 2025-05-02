import { readFileSync } from 'fs';
import { join } from 'path';
import { buildSchema, GraphQLScalarType, Kind, GraphQLSchema } from 'graphql';

export const JSONObjectResolver = new GraphQLScalarType({
  name: 'JSONObject',
  description: 'A generic JSON object scalar type',
  serialize(value: unknown) {
    if (typeof value === 'object' && value !== null) {
      return value;
    }
    throw new Error('JSONObject cannot represent non-object value: ' + value);
  },
  parseValue(value: unknown) {
     if (typeof value === 'object' && value !== null) {
      return value;
    }
    throw new Error('JSONObject cannot represent non-object value: ' + value);
  },
  parseLiteral(ast) {
    if (ast.kind === Kind.OBJECT || ast.kind === Kind.LIST || ast.kind === Kind.STRING || ast.kind === Kind.INT || ast.kind === Kind.FLOAT || ast.kind === Kind.BOOLEAN || ast.kind === Kind.NULL) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (ast as any).value;
    }
    throw new Error('JSONObject cannot represent literal value: ' + ast);
  },
});

export const schemaString = readFileSync(join(__dirname, '../schema.graphql'), 'utf8');

export const schema: GraphQLSchema = buildSchema(schemaString);
