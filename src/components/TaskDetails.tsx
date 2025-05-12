import React, { useState } from 'react';
import styles from './TaskDetails.module.css';

import { Message, MessagePart, Task } from '../types';

interface TaskDetailsProps {
  currentTask: Task | null;
  streamingOutput: string;
  onDuplicateClick: () => void;
}

const TaskDetails: React.FC<TaskDetailsProps> = ({
  currentTask,
  streamingOutput,
}) => {
  // State to manage collapsed state of think blocks
  const [collapsedThinkBlocks, setCollapsedThinkBlocks] = useState<{ [key: string]: boolean }>({});

  // Function to toggle collapsed state
  const toggleThinkBlock = (key: string) => {
    setCollapsedThinkBlocks(prevState => ({
      ...prevState,
      [key]: !prevState[key],
    }));
  };

  const renderMessagePart = (messageIndex: number, part: MessagePart, partIndex: number, taskArtifacts: Task['artifacts']) => {
    if (typeof part !== 'object' || part === null || !part.type) {
      return <pre key={`${messageIndex}-${partIndex}-unsupported`} className={styles.messagePartPre}>Unsupported part structure: {JSON.stringify(part, null, 2)}</pre>;
    }

    const partData = part as any;

    switch (partData.type) {
      case 'text':
        const textContent = partData.text || '';
        const thinkBlockRegex = /<think>(.*?)<\/think>/gs;
        let lastIndex = 0;
        const elements: React.JSX.Element[] = [];
        let thinkBlockMatch;
        let thinkBlockIndex = 0;

        while ((thinkBlockMatch = thinkBlockRegex.exec(textContent)) !== null) {
          // Add text before the think block
          if (thinkBlockMatch.index > lastIndex) {
            elements.push(
              <pre key={`${messageIndex}-${partIndex}-text-${lastIndex}`} className={styles.messagePartPre}>
                {textContent.substring(lastIndex, thinkBlockMatch.index)}
              </pre>
            );
          }

          // Add the think block
          const thinkBlockContent = thinkBlockMatch[1];
          const blockKey = `${messageIndex}-${partIndex}-think-${thinkBlockIndex}`;
          const isCollapsed = collapsedThinkBlocks[blockKey] ?? true; // Default to collapsed

          elements.push(
            <div key={blockKey} className={styles.thinkBlockContainer}>
              <div className={styles.thinkBlockHeader} onClick={() => toggleThinkBlock(blockKey)}>
                <span className={`${styles.thinkBlockToggle} ${isCollapsed ? styles.collapsed : styles.expanded}`}>
                  {isCollapsed ? '-' : '~'}
                </span>
                Thinking Process
              </div>
              {!isCollapsed && (
                <pre className={styles.thinkBlockContent}>
                  {thinkBlockContent}
                </pre>
              )}
            </div>
          );

          lastIndex = thinkBlockRegex.lastIndex;
          thinkBlockIndex++;
        }

        // Add any remaining text after the last think block
        if (lastIndex < textContent.length) {
          elements.push(
            <pre key={`${messageIndex}-${partIndex}-text-${lastIndex}`} className={styles.messagePartPre}>
              {textContent.substring(lastIndex)}
            </pre>
          );
        }

        return <>{elements}</>;

      case 'data':
        if (!partData.mimeType?.startsWith('text/')) {
          return (
            <div key={`${messageIndex}-${partIndex}-data`} className={styles.dataArtifactContainer}>
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
                  <div key={`${messageIndex}-${partIndex}-uri`} className={styles.uriArtifactContainer}>
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
            <div key={`${messageIndex}-${partIndex}-file`} className={styles.fileArtifactContainer}>
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
          return <pre key={`${messageIndex}-${partIndex}-default`} className={styles.messagePartPre}>Unsupported part type: {JSON.stringify(part, null, 2)}</pre>;
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
          <div><strong>ID:</strong> {currentTask.id}</div>
          {currentTask.createdAt && <div><strong>Created:</strong> {new Date(currentTask.createdAt).toLocaleString()}</div>}
          {currentTask.updatedAt && <div><strong>Updated:</strong> {new Date(currentTask.updatedAt).toLocaleString()}</div>}
          {currentTask.error && <div className={styles.errorText}><strong>Error:</strong> {currentTask.error}</div>}
        </div>
      )}

      {historyMessages.length > 0 && (
        <div className={styles.taskHistorySection}>
          {historyMessages.map((message, msgIndex) => (
            <div key={msgIndex} className={`${styles.messageContainer} ${message.role === 'USER' ? styles.userMessage : styles.agentMessage}`}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <strong className={styles.messageRole}>
                  {message.role === 'USER' ? '👨🏻‍💻':''}
                  {message.role === 'TOOL' ? '⚙️':''}
                  {message.role === 'ASSISTANT' ? '🤖':''} {message.role.toLowerCase()}</strong>
                {message.timestamp && <span className={styles.messageTimestamp}>{new Date(message.timestamp).toLocaleString()}</span>}
              </div>
              {message.parts.map((part, partIndex) => renderMessagePart(msgIndex, part, partIndex, currentTask?.artifacts))}
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
