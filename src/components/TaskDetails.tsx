import React, { useState, FormEvent } from 'react'; // Import FormEvent
import styles from './TaskDetails.module.css';
import { gql, useMutation } from '@apollo/client'; // Import gql and useMutation

import { Message, MessagePart, Task } from '../types';

// Define the GraphQL mutation
const ADD_USER_MESSAGE_TO_TASK_MUTATION = gql`
  mutation AddUserMessageToTask($taskId: ID!, $message: String!) {
    addUserMessageToTask(taskId: $taskId, message: $message) {
      id
      state
      messages {
        role
        parts
        timestamp
        timestampUnixMs
      }
      error
      createdAt
      createdAtUnixMs
      updatedAt
      updatedAtUnixMs
      artifacts
      agentId
    }
  }
`;


interface TaskDetailsProps {
  currentTask: Task | null;
  streamingOutput: string;
  onDuplicateClick: () => void; // Keep this prop if needed elsewhere, though not used in render
}

const TaskDetails: React.FC<TaskDetailsProps> = ({
  currentTask,
  streamingOutput,
}) => {
  // State to manage collapsed state of think blocks
  const [collapsedThinkBlocks, setCollapsedThinkBlocks] = useState<{ [key: string]: boolean }>({});
  // State to manage collapsed state of tool blocks
  const [collapsedToolBlocks, setCollapsedToolBlocks] = useState<{ [key: string]: boolean }>({});
  // State to manage user input message
  const [userMessageInput, setUserMessageInput] = useState('');
  // State to manage loading state of the mutation
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  // State to manage error state of the mutation
  const [sendMessageError, setSendMessageError] = useState<string | null>(null);


  // Use the useMutation hook
  const [addUserMessage] = useMutation(ADD_USER_MESSAGE_TO_TASK_MUTATION, {
    onCompleted: (data) => {
      console.log('Message added successfully:', data);
      setUserMessageInput(''); // Clear input on success
      setIsSendingMessage(false);
      setSendMessageError(null);
      // The taskUpdates subscription should handle updating the UI with the new message
    },
    onError: (error) => {
      console.error('Error adding message:', error);
      setIsSendingMessage(false);
      setSendMessageError(error.message);
    },
  });


  // Function to toggle collapsed state for think blocks
  const toggleThinkBlock = (key: string) => {
    setCollapsedThinkBlocks(prevState => ({
      ...prevState,
      [key]: !prevState[key],
    }));
  };

  // Function to toggle collapsed state for tool blocks
  const toggleToolBlock = (key: string) => { // Corrected function name
    setCollapsedToolBlocks(prevState => ({
      ...prevState,
      [key]: !prevState[key],
    }));
  };

  // Handler for sending the user message
  const handleSendMessage = async (event: FormEvent) => {
    event.preventDefault(); // Prevent default form submission

    if (!currentTask || !userMessageInput.trim() || isSendingMessage) {
      return; // Don't send if no task, empty message, or already sending
    }

    setIsSendingMessage(true);
    setSendMessageError(null);

    try {
      await addUserMessage({
        variables: {
          taskId: currentTask.id,
          message: userMessageInput.trim(),
        },
      });
      // onCompleted and onError handlers will manage state updates
    } catch (error) {
      // This catch block is for errors not caught by the onError option in useMutation
      console.error('Unexpected error during message sending:', error);
      setIsSendingMessage(false);
      setSendMessageError('An unexpected error occurred.');
    }
  };


  const renderMessagePart = (message: Message, messageIndex: number, part: MessagePart, partIndex: number, taskArtifacts: Task['artifacts']) => {
    if (typeof part !== 'object' || part === null || !part.type) {
      return <pre key={`${messageIndex}-${partIndex}-unsupported`} className={styles.messagePartPre}>Unsupported part structure: {JSON.stringify(part, null, 2)}</pre>;
    }

    const partData = part as any;

    // Handle tool messages separately
    if (message.role === 'TOOL') {
      const blockKey = `${messageIndex}-${partIndex}-tool`;
      const isCollapsed = collapsedToolBlocks[blockKey] ?? true; // Default to collapsed

      let toolDescription = '⚙️ tool';
      let toolDetails = '';
      let toolResultContent = null; // To hold the actual tool result or error

      // Tool result messages should have a single text part containing JSON
      if (partData.type === 'text' && partData.text) {
        try {
          const toolResult = JSON.parse(partData.text);
          if (toolResult.tool_name) {
            toolDescription = ''
            
            toolResultContent = toolResult.result || toolResult.error; // Get result or error

            // Construct details based on tool name and arguments
            const toolCallArguments = toolResult.arguments; // Arguments are now directly in the JSON
            switch (toolResult.tool_name) {
              case 'read_file':
                toolDescription = `📄 reading file`;
                if (toolCallArguments && toolCallArguments.path) {
                  toolDetails = ` "${toolCallArguments.path}"`;
                  if (toolCallArguments.from_line !== undefined || toolCallArguments.to_line !== undefined) {
                    toolDetails += ` (lines ${toolCallArguments.from_line ?? 0}-${toolCallArguments.to_line ?? 'end'})`;
                  }
                }
                break;
              case 'search_files':
                toolDescription = `🔍 searching files`;
                if (toolCallArguments) {
                  toolDetails = ` "${toolCallArguments.path}" for "${toolCallArguments.regex}"`;
                  if (toolCallArguments.file_pattern) {
                    toolDetails += ` (pattern: "${toolCallArguments.file_pattern}")`;
                  }
                }
                break;
              case 'write_to_file':
                  toolDescription = `📝 writing to file`;
                 if (toolCallArguments && toolCallArguments.path) {
                    toolDetails = ` "${toolCallArguments.path}"`;
                 }
                 break;
              case 'execute_command':
                  toolDescription = `💻 executing command`;
                 if (toolCallArguments && toolCallArguments.command) {
                    toolDetails = `: ${toolCallArguments.command}`;
                 }
                 break;
              case 'list_files':
                  toolDescription = `📂 listing files`;
                 if (toolCallArguments && toolCallArguments.path) {
                    toolDetails = ` "${toolCallArguments.path}"`;
                    if (toolCallArguments.recursive) {
                       toolDetails += ` (recursive)`;
                    }
                 }
                 break;
              case 'ask_followup_question':
                  toolDescription = `❓ asking follow-up question`;
                 break;
              case 'new_task':
                 toolDescription = `🛠️ creating new task`;
                 break;
              default:
                toolDescription = `⚙️ ${toolResult.tool_name}`;
                // Default for unknown tools
                if (toolCallArguments) {
                   toolDetails = `: ${JSON.stringify(toolCallArguments).substring(0, 50)}...`; // Show truncated arguments
                }
                break;
            }
          } else {
             // If tool_name is not present in the JSON, fall back to generic display
             toolDescription = '⚙️ tool (JSON missing tool_name)';
             toolResultContent = partData.text; // Display the raw text
          }
        } catch (e) {
          // If parsing fails, fall back to generic display and show raw text
          console.error("Failed to parse tool result JSON:", e);
          toolDescription = '⚙️ tool (Invalid JSON)';
          toolResultContent = partData.text; // Display the raw text
        }
      } else {
         // If not a text part or text is empty, fall back to generic display
         toolDescription = '⚙️ tool (No text content)';
         toolResultContent = JSON.stringify(partData, null, 2); // Display raw part data
      }


      // Construct the header string with tool description, details, and timestamp
      const headerText = `${toolDescription}${toolDetails}`;
      const timestampText = message.timestamp ? new Date(message.timestamp).toLocaleString() : '';

      return (
        <div key={blockKey} className={styles.toolBlockContainer}>
          {!isCollapsed && (
            <div className={styles.toolBlockContent}>
              {toolResultContent !== null ? (
                <pre className={styles.toolBlockTextContent}>{toolResultContent}</pre>
              ) : partData.type === 'text' ? (
                 <pre className={styles.toolBlockTextContent}>{partData.text}</pre>
              ) : (
                <pre className={styles.toolBlockJsonContent}>
                  {JSON.stringify(partData, null, 2)}
                </pre>
              )}
            </div>
          )}

          <div className={styles.toolBlockHeader} onClick={() => toggleToolBlock(blockKey)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ flexGrow: 1 }}>
                 <strong>{headerText}</strong>
              </span>
              {timestampText && <span className={styles.messageTimestamp}>{timestampText}</span>}
           </div>
        </div>
      );
    }


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
                  {isCollapsed ? '💭' : '🌧️'}
                </span>
                thinking...
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

              {message.role != 'TOOL' && (
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  {message.timestamp && <span className={styles.messageTimestamp}>{new Date(message.timestamp).toLocaleString()}</span>}
              </div>
              )}

              {message.parts.map((part, partIndex) => renderMessagePart(message, msgIndex, part, partIndex, currentTask?.artifacts))}
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

      {/* Add the user input form */}
      {currentTask && ( // Only show the form if a task is selected
        <form onSubmit={handleSendMessage} className={styles.messageInputForm}>
          <textarea
            className={styles.messageInputTextarea}
            value={userMessageInput}
            onChange={(e) => setUserMessageInput(e.target.value)}
            placeholder="Type your message here..."
            rows={3}
            disabled={isSendingMessage} // Disable while sending
          />
          <button
            type="submit"
            className={styles.sendMessageButton}
            disabled={!userMessageInput.trim() || isSendingMessage} // Disable if input is empty or sending
          >
            {isSendingMessage ? 'Sending...' : 'Send Message'}
          </button>
          {sendMessageError && (
            <div className={styles.errorMessage}>{sendMessageError}</div>
          )}
        </form>
      )}

    </div>
  );
};


export default TaskDetails;
