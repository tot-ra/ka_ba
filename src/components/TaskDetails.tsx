import React from 'react';

import { MessageRole, Message, MessagePart } from '../types';

interface TaskDetailsProps {
  currentTask: {
    id: string;
    state: string;
    input?: any[] | null;
    output?: any[] | null;
    error?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    artifacts?: Record<string, { id: string; type: string; filename?: string | null }> | null;
  } | null;
  streamingOutput: string;
  onDuplicateClick: () => void;
}

const renderMessagePart = (part: MessagePart, index: number, taskArtifacts: Record<string, { id: string; type: string; filename?: string | null }> | null | undefined) => {
  if (typeof part !== 'object' || part === null || !part.type) {
    return <pre key={index} style={{ fontSize: '0.9em' }}>Unsupported part structure: {JSON.stringify(part, null, 2)}</pre>;
  }

  const partData = part as any;

  switch (partData.type) {
    case 'text':
      return <pre key={index} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f9f9f9', padding: '8px', margin: '5px 0 0 0', borderRadius: '4px' }}>{partData.text}</pre>;
    case 'data':
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
      return null;
    case 'uri':
       if (!partData.mimeType?.startsWith('text/')) {
            return (
                <div key={index} style={{ marginTop: '5px' }}>
                    <a href={partData.uri} target="_blank" rel="noopener noreferrer">
                        View/Download Artifact ({partData.mimeType || 'link'})
                    </a>
                </div>
            );
       }
       return null;
    case 'file':
      if (!partData.mimeType?.startsWith('text/')) {
        const artifactDetail = partData.artifactId && taskArtifacts ? taskArtifacts?.[partData.artifactId] : null;
        const displayName = artifactDetail?.filename || partData.fileName || 'Unnamed File';
        const displayType = partData.mimeType || artifactDetail?.type || 'unknown type';
        const downloadLink = partData.uri;

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
      return null;
    default:
      if (!partData.mimeType?.startsWith('text/')) {
        return <pre key={index} style={{ fontSize: '0.9em', marginTop: '5px' }}>Unsupported part type: {JSON.stringify(part, null, 2)}</pre>;
      }
      return null;
  }
};

const getStatusStyle = (state: string | undefined | null): React.CSSProperties => {
  let backgroundColor = '#eee';
  let color = '#333';
  switch (state?.toUpperCase()) {
     case 'SUBMITTED':
     case 'UNKNOWN':
        backgroundColor = '#d3d3d3';
        break;
     case 'WORKING':
        backgroundColor = '#cfe2ff';
        color = '#004085';
        break;
     case 'INPUT_REQUIRED':
        backgroundColor = '#fff3cd';
        color = '#856404';
        break;
     case 'COMPLETED':
        backgroundColor = '#d4edda';
        color = '#155724';
        break;
     case 'CANCELED':
     case 'FAILED':
        backgroundColor = '#f8d7da';
        color = '#721c24';
        break;
     default:
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
  onDuplicateClick,
}) => {
  const historyMessages: Message[] = [
    ...(currentTask?.input || []),
    ...(currentTask?.output || []),
  ];

  if (!currentTask && !streamingOutput && historyMessages.length === 0) {
    return null;
  }

  const canDuplicate = !!currentTask?.input;
  const duplicateTitle = !canDuplicate ? 'Duplication logic needs update based on GraphQL schema' : 'Duplicate Task (copies prompt to input)';

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '0' }}>

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

      {historyMessages.length > 0 && (
        <div style={{ marginBottom: '20px' }}>
          <h3>Task History</h3>
          {historyMessages.map((message, msgIndex) => (
            <div key={msgIndex} style={{ border: '1px solid #ddd', padding: '10px', borderRadius: '4px', marginBottom: '10px', background: message.role === 'USER' ? '#eef' : '#f8f8f8' }}>
              <strong style={{ textTransform: 'capitalize', display: 'block', marginBottom: '5px' }}>{message.role.toLowerCase()}</strong>
              {message.parts.map((part, partIndex) => renderMessagePart(part, partIndex, currentTask?.artifacts))}
            </div>
          ))}
        </div>
      )}

      {streamingOutput && (
        <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '4px', background: '#fff9e6' }}>
          <h3>Live Output Stream</h3>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>{streamingOutput}</pre>
        </div>
      )}

    </div>
  );
};

export default TaskDetails;
