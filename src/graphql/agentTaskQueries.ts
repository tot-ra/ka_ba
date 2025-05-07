import { gql } from '@apollo/client';

export const DELETE_TASK_MUTATION = gql`
  mutation DeleteTask($agentId: ID!, $taskId: ID!) {
    deleteTask(agentId: $agentId, taskId: $taskId)
  }
`;

export const TASK_UPDATES_SUBSCRIPTION = gql`
  subscription TaskUpdates($agentId: ID!) {
    taskUpdates(agentId: $agentId) {
      id
      state
      messages { # Use the new messages field
        role
        parts
        timestamp # Include timestamp
      }
      error
      createdAt
      updatedAt
      artifacts
    }
  }
`;

export const LIST_TASKS_QUERY = gql`
  query ListTasks($agentId: ID!) {
    listTasks(agentId: $agentId) {
      id
      state
      name
      messages { # Use the new messages field
        role
        parts
        timestamp # Include timestamp
      }
      error
      createdAt
      updatedAt
      artifacts
    }
  }
`;

export const CREATE_TASK_MUTATION = gql`
  mutation CreateTask($agentId: ID, $message: InputMessage!) {
    createTask(agentId: $agentId, message: $message) {
      id
      state
      messages { # Use the new messages field
        role
        parts
        toolCalls
        toolCallId
        timestamp # Include timestamp
      }
      error
      createdAt
      updatedAt
      artifacts
    }
  }
`;
