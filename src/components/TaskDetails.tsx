import React from 'react';
import styles from './TaskDetails.module.css';

import { MessageRole, Message, MessagePart, Task } from '../types'; // Import Task type

interface TaskDetailsProps {
  currentTask: Task | null; // Use the updated Task type
  streamingOutput: string;
  onDuplicateClick: () => void;
}

const renderMessagePart = (part: MessagePart, index: number, taskArtifacts: Task['artifacts']) => { // Use Task['artifacts'] for type safety
  if (typeof part !== 'object' || part === null || !part.type) {
    return <pre key={index} className={styles.messagePartPre}>Unsupported part structure: {JSON.stringify(part, null, 2)}</pre>;
  }

  const partData = part as any;

  switch (partData.type) {
    case 'text':
      return <pre key={index} className={styles.messagePartPre}>{partData.text}</pre>;
    case 'data':
      if (!partData.mimeType?.startsWith('text/')) {
        return (
          <div key={index} className={styles.dataArtifactContainer}>
            <strong>Data Artifact ({partData.mimeType || 'unknown type'}):</strong>
            <pre className={styles.dataArtifactPre}>
              {JSON.stringify(partData.data, null, 2)}
            </pre>
          </div>
        );
      }
      return null;
    case 'uri':
       if (!partData.mimeType?.startsWith('text/')) {
            return (
                <div key={index} className={styles.uriArtifactContainer}>
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
          <div key={index} className={styles.fileArtifactContainer}>
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
        return <pre key={index} className={styles.messagePartPre}>Unsupported part type: {JSON.stringify(part, null, 2)}</pre>;
      }
      return null;
  }
};

const getStatusClassName = (state: string | undefined | null): string => {
  switch (state?.toUpperCase()) {
     case 'SUBMITTED':
     case 'UNKNOWN':
        return styles.statusSubmitted;
     case 'WORKING':
        return styles.statusWorking;
     case 'INPUT_REQUIRED':
        return styles.statusInputRequired;
     case 'COMPLETED':
        return styles.statusCompleted;
     case 'CANCELED':
     case 'FAILED':
        return styles.statusCanceled;
     default:
        return '';
  }
};


const TaskDetails: React.FC<TaskDetailsProps> = ({
  currentTask,
  streamingOutput,
  onDuplicateClick,
}) => {
  // Use the messages array from the currentTask
  const historyMessages: Message[] = currentTask?.messages || [];

  if (!currentTask && !streamingOutput && historyMessages.length === 0) {
    return null;
  }

  // Update duplication logic to use the first message in the combined history
  const canDuplicate = historyMessages.length > 0 && historyMessages[0].role === 'USER';
  const duplicateTitle = !canDuplicate ? 'Cannot duplicate: No user input found in history' : 'Duplicate Task (copies prompt to input)';

  return (
    <div className={styles.taskDetailsContainer}>

      {currentTask && (
        <div className={styles.taskStatusSection}>
          <div>
            <strong>Status:</strong>{' '}
            <span className={`${styles.statusBadge} ${getStatusClassName(currentTask.state)}`}>{currentTask.state}</span>
          </div>
          {currentTask.createdAt && <div><strong>Created:</strong> {new Date(currentTask.createdAt).toLocaleString()}</div>}
          {currentTask.updatedAt && <div><strong>Updated:</strong> {new Date(currentTask.updatedAt).toLocaleString()}</div>}
          {currentTask.error && <div className={styles.errorText}><strong>Error:</strong> {currentTask.error}</div>}
          <button
            onClick={onDuplicateClick}
            disabled={!canDuplicate}
            title={duplicateTitle}
            className={styles.duplicateButton}
          >
            Duplicate Task
          </button>
        </div>
      )}

      {historyMessages.length > 0 && (
        <div className={styles.taskHistorySection}>
          <h3>Task History</h3>
          {historyMessages.map((message, msgIndex) => (
            <div key={msgIndex} className={`${styles.messageContainer} ${message.role === 'USER' ? styles.userMessage : styles.agentMessage}`}>
              <strong className={styles.messageRole}>{message.role.toLowerCase()}</strong>
              {/* Optionally display timestamp */}
              {message.timestamp && <span className={styles.messageTimestamp}>{new Date(message.timestamp).toLocaleString()}</span>}
              {message.parts.map((part, partIndex) => renderMessagePart(part, partIndex, currentTask?.artifacts))}
            </div>
          ))}
        </div>
      )}

      {streamingOutput && (
        <div className={styles.liveOutputStreamSection}>
          <h3>Live Output Stream</h3>
          <pre className={styles.liveOutputStreamPre}>{streamingOutput}</pre>
        </div>
      )}

    </div>
  );
};

export default TaskDetails;
