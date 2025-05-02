import React from 'react';

// Removed local interface definitions - rely on prop types derived from GraphQL schema
import { MessageRole, Message, MessagePart } from '../types'; // Assuming MessageRole enum is defined here or imported globally

interface TaskDetailsProps {
  // Expect currentTask to match GraphQL Task type structure
  currentTask: {
    id: string;
    state: string; // Top-level state
    input?: any[] | null; // Map history to input?
    output?: any[] | null;
    error?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    artifacts?: Record<string, { id: string; type: string; filename?: string | null }> | null; // More specific type based on schema
    // Add other fields from GraphQL Task type if used
  } | null;
  streamingOutput: string;
  // artifacts prop removed - artifacts will be displayed inline with messages
  onDuplicateClick: () => void; // Function to handle duplicating the task
}

// Helper function to render individual message parts
const renderMessagePart = (part: MessagePart, index: number, taskArtifacts: Record<string, { id: string; type: string; filename?: string | null }> | null | undefined) => {
  // Defensive check in case part is not an object or lacks type
  if (typeof part !== 'object' || part === null || !part.type) {
    return <pre key={index} style={{ fontSize: '0.9em' }}>Unsupported part structure: {JSON.stringify(part, null, 2)}</pre>;
  }

  // Use type assertion carefully or check properties
  const partData = part as any; // Use 'any' for simplicity, consider type guards for robustness

  switch (partData.type) {
    case 'text':
      return <pre key={index} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f9f9f9', padding: '8px', margin: '5px 0 0 0', borderRadius: '4px' }}>{partData.text}</pre>;
    case 'data':
      // Only render data if it's not text/plain (or similar) - adjust mimeType check as needed
      if (!partData.mimeType?.startsWith('text/')) {
        return (
          <div key={index} style={{ marginTop: '5px' }}>
            <strong>Data Artifact ({partData.mimeType || 'unknown type'}):</strong>
            <pre style={{ fontSize: '0.9em', background: '#f0f0f0', padding: '5px', margin: '5px 0 0 0', borderRadius: '4px' }}>
              {JSON.stringify(partData.data, null, 2)}
            </pre>
          </div>
        );
      }
      // Optionally render text data differently or omit
      // return <pre key={index}>Text Data: {JSON.stringify(partData.data)}</pre>;
      return null; // Don't render text data inline here, assume it's less relevant than text parts
    case 'uri':
       // Only render if not text/plain
       if (!partData.mimeType?.startsWith('text/')) {
            return (
                <div key={index} style={{ marginTop: '5px' }}>
                    <a href={partData.uri} target="_blank" rel="noopener noreferrer">
                        View/Download Artifact ({partData.mimeType || 'link'})
                    </a>
                </div>
            );
       }
       return null; // Don't render text links inline here
    case 'file':
      // Only render if not text/plain
      if (!partData.mimeType?.startsWith('text/')) {
        const artifactDetail = partData.artifactId && taskArtifacts ? taskArtifacts?.[partData.artifactId] : null;
        const displayName = artifactDetail?.filename || partData.fileName || 'Unnamed File';
        const displayType = partData.mimeType || artifactDetail?.type || 'unknown type';
        const downloadLink = partData.uri; // Assuming URI is provided for download

        return (
          <div key={index} style={{ marginTop: '5px' }}>
            <strong>File Artifact:</strong> {displayName} ({displayType})
            {downloadLink ? (
              <> - <a href={downloadLink} target="_blank" rel="noopener noreferrer">Download/View</a></>
            ) : (
              <span> - Download not available</span>
            )}
          </div>
        );
      }
      return null; // Don't render text files inline here
    default:
      // Render other non-text types
      if (!partData.mimeType?.startsWith('text/')) {
        return <pre key={index} style={{ fontSize: '0.9em', marginTop: '5px' }}>Unsupported part type: {JSON.stringify(part, null, 2)}</pre>;
      }
      return null; // Don't render other text types
  }
};

// Helper function to get status style (accepts string state now)
const getStatusStyle = (state: string | undefined | null): React.CSSProperties => {
  let backgroundColor = '#eee'; // Default style
  let color = '#333';
  switch (state?.toUpperCase()) { // Convert to uppercase for comparison
     case 'SUBMITTED':
     case 'UNKNOWN': // Assuming UNKNOWN might be possible
        backgroundColor = '#d3d3d3'; // Light Gray
        break;
     case 'WORKING':
        backgroundColor = '#cfe2ff'; // Light Blue
        color = '#004085';
        break;
     case 'INPUT_REQUIRED':
        backgroundColor = '#fff3cd'; // Light Yellow
        color = '#856404';
        break;
     case 'COMPLETED':
        backgroundColor = '#d4edda'; // Light Green
        color = '#155724';
        break;
     case 'CANCELED':
     case 'FAILED':
        backgroundColor = '#f8d7da'; // Light Red
        color = '#721c24';
        break;
     default:
        // Keep default style for unrecognized states
        break;
  }
  return {
     display: 'inline-block',
     padding: '0.25em 0.6em',
     fontSize: '75%',
     fontWeight: 700,
     lineHeight: 1,
     textAlign: 'center',
     whiteSpace: 'nowrap',
     verticalAlign: 'baseline',
     borderRadius: '0.25rem',
     backgroundColor,
     color,
  };
};


const TaskDetails: React.FC<TaskDetailsProps> = ({
  currentTask,
  streamingOutput,
  // artifacts prop removed
  onDuplicateClick,
}) => {
  // Combine input and output messages for history display
  const historyMessages: Message[] = [
    ...(currentTask?.input || []),
    ...(currentTask?.output || []),
  ];

  if (!currentTask && !streamingOutput && historyMessages.length === 0) {
    return null; // Don't render anything if there's no task data to show
  }

  // TODO: Update duplication logic based on actual GraphQL Task structure (e.g., currentTask.input)
  // TODO: Update duplication logic based on actual GraphQL Task structure (e.g., currentTask.input)
  // Placeholder logic for now:
  const canDuplicate = !!currentTask?.input; // Simple check if input exists
  const duplicateTitle = !canDuplicate ? 'Duplication logic needs update based on GraphQL schema' : 'Duplicate Task (copies prompt to input)';

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '0' }}>

      {/* Task Header Info (Optional - Keep if useful) */}
      {currentTask && (
        <div style={{ marginBottom: '20px', paddingBottom: '10px', borderBottom: '1px solid #eee' }}>
          <div>
            <strong>Status:</strong>{' '}
            <span style={getStatusStyle(currentTask.state)}>{currentTask.state}</span>
          </div>
          {currentTask.createdAt && <div><strong>Created:</strong> {new Date(currentTask.createdAt).toLocaleString()}</div>}
          {currentTask.updatedAt && <div><strong>Updated:</strong> {new Date(currentTask.updatedAt).toLocaleString()}</div>}
          {currentTask.error && <div style={{ color: 'red', marginTop: '5px' }}><strong>Error:</strong> {currentTask.error}</div>}
          <button
            onClick={onDuplicateClick}
            disabled={!canDuplicate}
            title={duplicateTitle}
            style={{ marginTop: '10px', padding: '5px 10px', cursor: canDuplicate ? 'pointer' : 'not-allowed' }}
          >
            Duplicate Task
          </button>
        </div>
      )}

      {/* Display Task History */}
      {historyMessages.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <h3>Task History</h3>
          {historyMessages.map((message, msgIndex) => (
            <div key={msgIndex} style={{ border: '1px solid #ddd', padding: '10px', borderRadius: '4px', marginBottom: '10px', background: message.role === 'USER' ? '#eef' : '#f8f8f8' }}>
              <strong style={{ textTransform: 'capitalize', display: 'block', marginBottom: '5px' }}>{message.role.toLowerCase()}</strong>
              {message.parts.map((part, partIndex) => renderMessagePart(part, partIndex, currentTask?.artifacts))}
              {/* TODO: Render toolCalls if needed */}
            </div>
          ))}
        </div>
      )}

      {/* Display streaming output */}
      {streamingOutput && (
        <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '4px', background: '#fff9e6' }}>
          <h3>Live Output Stream</h3>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{streamingOutput}</pre>
        </div>
      )}

      {/* Separate Artifacts section removed - artifacts are now inline */}

    </div>
  );
};

export default TaskDetails;
