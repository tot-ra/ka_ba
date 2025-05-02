import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  ApolloClient,
  InMemoryCache,
  ApolloProvider,
  split,
  HttpLink,
} from '@apollo/client';
import { getMainDefinition } from '@apollo/client/utilities';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions'; // Correct import path
import { createClient } from 'graphql-ws'; // Correct import path

import App from './App'; // Removed .tsx extension
import './index.css'; // Assuming a basic index.css might be needed

// --- Apollo Client Setup ---

// HTTP Link for queries and mutations
const httpLink = new HttpLink({
  uri: 'http://localhost:3000/graphql', // Your GraphQL HTTP endpoint
});

// WebSocket Link for subscriptions
const wsLink = new GraphQLWsLink(createClient({
  url: 'ws://localhost:3000/graphql', // Your GraphQL WebSocket endpoint
  connectionParams: () => {
    // Optional: Add connection parameters like authentication tokens
    // const token = localStorage.getItem('token');
    // return token ? { Authorization: `Bearer ${token}` } : {};
    return {};
  },
}));

// Use splitLink to route requests based on operation type
const splitLink = split(
  ({ query }) => {
    const definition = getMainDefinition(query);
    return (
      definition.kind === 'OperationDefinition' &&
      definition.operation === 'subscription'
    );
  },
  wsLink, // Route subscriptions to wsLink
  httpLink, // Route queries/mutations to httpLink
);

// Create the Apollo Client instance
const client = new ApolloClient({
  link: splitLink,
  cache: new InMemoryCache(),
});

// --- Render Application ---

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ApolloProvider client={client}>
      <App />
    </ApolloProvider>
  </React.StrictMode>,
);
