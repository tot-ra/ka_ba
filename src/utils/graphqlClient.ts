import axios, { AxiosError } from 'axios';

const GRAPHQL_ENDPOINT = 'http://localhost:3000/graphql';

// Define a generic structure for GraphQL responses
interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; extensions?: { code?: string } }>;
}

/**
 * Sends a GraphQL request to the backend endpoint.
 * @param query The GraphQL query or mutation string.
 * @param variables An optional object containing variables for the query/mutation.
 * @returns A promise that resolves with the GraphQL response data.
 * @throws Throws an error if the request fails or GraphQL returns errors.
 */
export async function sendGraphQLRequest<T = any>( // Use generic T for expected data shape
  query: string,
  variables?: Record<string, any>
): Promise<GraphQLResponse<T>> { // Return the full response structure
  try {
    const response = await axios.post<GraphQLResponse<T>>(GRAPHQL_ENDPOINT, {
      query,
      variables,
    });

    // Return the full response, allowing the caller to handle data/errors
    return response.data;

  } catch (error: any) {
    console.error('GraphQL request failed:', error);

    // Try to extract GraphQL errors from the response if it's an AxiosError
    if (axios.isAxiosError(error) && error.response?.data?.errors) {
      // Re-throw the structured GraphQL error response part
      throw new Error(`GraphQL Error: ${error.response.data.errors.map((e: any) => e.message).join(', ')}`);
    }

    // Throw a generic error for network or other issues
    throw new Error(error.message || 'An unknown error occurred during the GraphQL request.');
  }
}
