import React from 'react';

// Removed local interface definitions - rely on prop types derived from GraphQL schema

// Define a simplified Artifact type for props if not imported
interface DisplayArtifact {
  name?: string | null;
  description?: string | null;
  parts: any[]; // Keep parts flexible for now
  // Other fields like index, append, lastChunk might not be needed for display
}

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
    artifacts?: any | null; // Adjust type as needed
    // Add other fields from GraphQL Task type if used
  } | null;
  streamingOutput: string;
  artifacts: DisplayArtifact[]; // Use simplified artifact type for display
  onDuplicateClick: () => void; // Function to handle duplicating the task
}

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
  artifacts,
  onDuplicateClick,
}) => {

  if (!currentTask && !streamingOutput && artifacts.length === 0) {
    return null; // Don't render anything if there's no task data to show
  }

  // TODO: Update duplication logic based on actual GraphQL Task structure (e.g., currentTask.input)
  // Placeholder logic for now:
  const canDuplicate = !!currentTask?.input; // Simple check if input exists
  const duplicateTitle = !canDuplicate ? 'Duplication logic needs update based on GraphQL schema' : 'Duplicate Task (copies prompt to input)';


  return (
    <>
      {currentTask && (
        <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '15px', borderRadius: '4px' }}>
          <h3>
             {/* Use top-level state */}
             Task Status: <span style={getStatusStyle(currentTask.state)}>{currentTask.state || 'UNKNOWN'}</span>
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
           {/* Display top-level error field from GraphQL Task type */}
           {currentTask.error && (
              <div style={{ marginTop: '10px', padding: '10px', border: '1px dashed #f8d7da', borderRadius: '4px', background: '#f8d7da', color: '#721c24' }}>
                 <h4>Error:</h4>
                 <p style={{ whiteSpace: 'pre-wrap', margin: '5px 0' }}>{currentTask.error}</p>
             </div>
          )}
           {/* TODO: Display input/output messages if needed, based on GraphQL Task structure */}
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
