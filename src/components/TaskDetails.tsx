import React from 'react';

// Re-define necessary interfaces locally or import if shared
interface Message {
  role: 'user' | 'agent';
  parts: any[];
  metadata?: any;
}

interface TaskStatus {
  state: 'submitted' | 'working' | 'input-required' | 'completed' | 'canceled' | 'failed' | 'unknown';
  message?: Message | null;
  timestamp: string;
}

interface Artifact {
  name?: string | null;
  description?: string | null;
  parts: any[];
  index: number;
  append?: boolean | null;
  lastChunk?: boolean | null;
  metadata?: any;
}

interface Task {
  id: string;
  sessionId?: string | null;
  status: TaskStatus;
  artifacts?: Artifact[] | null;
  history?: Message[] | null;
  metadata?: any;
}

interface TaskDetailsProps {
  currentTask: Task | null;
  streamingOutput: string;
  artifacts: Artifact[];
  onDuplicateClick: () => void; // Function to handle duplicating the task
}

// Helper function to get status style (can be moved to a utils file later if needed)
const getStatusStyle = (state: TaskStatus['state']): React.CSSProperties => {
  let backgroundColor = '#eee';
  let color = '#333';
  switch (state) {
     case 'submitted':
     case 'unknown':
        backgroundColor = '#d3d3d3'; // Light Gray
        break;
     case 'working':
        backgroundColor = '#cfe2ff'; // Light Blue
        color = '#004085';
        break;
     case 'input-required':
        backgroundColor = '#fff3cd'; // Light Yellow
        color = '#856404';
        break;
     case 'completed':
        backgroundColor = '#d4edda'; // Light Green
        color = '#155724';
        break;
     case 'canceled':
     case 'failed':
        backgroundColor = '#f8d7da'; // Light Red
        color = '#721c24';
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
  artifacts,
  onDuplicateClick,
}) => {

  if (!currentTask && !streamingOutput && artifacts.length === 0) {
    return null; // Don't render anything if there's no task data to show
  }

  const canDuplicate = currentTask?.history && currentTask.history.length > 0 && currentTask.history[0].role === 'user' && ['text', 'data'].includes(currentTask.history[0].parts?.[0]?.type);
  const duplicateTitle = !canDuplicate ? 'Duplication only supported for tasks initiated with text or data' : 'Duplicate Task (copies prompt to input)';

  return (
    <>
      {currentTask && (
        <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '4px' }}>
          <h3>
             Task Status: <span style={getStatusStyle(currentTask.status.state)}>{currentTask.status.state}</span>
           </h3>
           <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
             <p style={{ margin: 0 }}>Task ID: {currentTask.id}</p>
             <button
               onClick={onDuplicateClick}
               disabled={!canDuplicate}
               title={duplicateTitle}
               style={{
                 padding: '5px 10px',
                 fontSize: '0.8em',
                 backgroundColor: '#6c757d',
                 color: 'white',
                 border: 'none',
                 borderRadius: '4px',
                 cursor: 'pointer',
                 opacity: !canDuplicate ? 0.5 : 1,
               }}
             >
               Duplicate Task
             </button>
           </div>
           {currentTask.status.message && (
              <div style={{ marginTop: '10px', padding: '10px', border: '1px dashed #ccc', borderRadius: '4px', background: '#f9f9f9' }}>
                 <h4>Agent Message:</h4>
                {currentTask.status.message.parts?.map((part, index) => {
                   if (part.type === 'text') {
                      return <p key={index} style={{ whiteSpace: 'pre-wrap', margin: '5px 0' }}>{part.text}</p>;
                   }
                   return <pre key={index} style={{ fontSize: '0.9em' }}>{JSON.stringify(part, null, 2)}</pre>;
                })}
                {(!currentTask.status.message.parts || currentTask.status.message.parts.length === 0) && (
                   <pre style={{ fontSize: '0.9em' }}>{JSON.stringify(currentTask.status.message, null, 2)}</pre>
                )}
             </div>
          )}
        </div>
      )}

      {/* Display streaming output */}
      {streamingOutput && (
         <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '4px' }}>
            <h3>Task Output</h3>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{streamingOutput}</pre>
         </div>
      )}

      {/* Display artifacts */}
       {artifacts.length > 0 && (
         <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '4px' }}>
            <h3>Artifacts</h3>
            <ul style={{ paddingLeft: '20px', listStyle: 'disc' }}>
               {artifacts.map((artifact, index) => (
                  <li key={index} style={{ marginBottom: '10px' }}>
                      <h4 style={{ marginBottom: '5px' }}>{artifact.name || `Artifact ${index + 1}`}</h4>
                      {artifact.description && <p style={{ margin: '0 0 5px 0', fontSize: '0.9em', fontStyle: 'italic' }}>{artifact.description}</p>}
                      {artifact.parts?.map((part, partIndex) => (
                         <div key={partIndex} style={{ marginTop: '5px', paddingLeft: '15px', borderLeft: '2px solid #eee' }}>
                            {part.type === 'text' && (
                               <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f0f0f0', padding: '5px', margin: 0 }}>{part.text}</pre>
                            )}
                            {part.type === 'data' && (
                               <pre style={{ fontSize: '0.9em', background: '#f0f0f0', padding: '5px', margin: 0 }}>{JSON.stringify(part.data, null, 2)}</pre>
                            )}
                            {part.type === 'uri' && (
                               <a href={part.uri} target="_blank" rel="noopener noreferrer">Download/View Artifact ({part.mimeType || 'link'})</a>
                            )}
                            {part.type === 'file' && (
                               <span>File: {part.fileName || 'Unnamed File'} ({part.mimeType}) - Download not implemented</span>
                            )}
                            {!['text', 'data', 'uri', 'file'].includes(part.type) && (
                                <pre style={{ fontSize: '0.9em' }}>Unsupported part type: {JSON.stringify(part, null, 2)}</pre>
                            )}
                         </div>
                      ))}
                   </li>
                ))}
             </ul>
         </div>
      )}
    </>
  );
};

export default TaskDetails;
