import React, { useState, useEffect, useRef } from 'react';
import { gql, useSubscription, useQuery, OnDataOptions, ApolloError } from '@apollo/client';

// Define LogEntry type matching the GraphQL schema
interface LogEntry {
  timestamp: string;
  stream: 'stdout' | 'stderr';
  line: string;
}

interface AgentLogsProps {
  agentId: string | null; // Accept agentId as a prop
}

const AgentLogs: React.FC<AgentLogsProps> = ({ agentId }) => {
  const [combinedLogs, setCombinedLogs] = useState<LogEntry[]>([]); // New state for combined logs
  const [historicalLogsLoading, setHistoricalLogsLoading] = useState<boolean>(true); // Start as true
  const logContainerRef = useRef<HTMLDivElement>(null);

  // --- GraphQL Operations ---

  const GET_AGENT_LOGS_QUERY = gql`
    query GetAgentLogs($agentId: ID!) {
      agentLogs(agentId: $agentId) # Assuming this returns String[]
    }
  `;

  const AGENT_LOGS_SUBSCRIPTION = gql`
    subscription AgentLogs($agentId: ID!) {
      agentLogs(agentId: $agentId) {
        timestamp
        stream
        line
      }
    }
  `;

  // Subscription for Agent Logs
  interface AgentLogsSubscriptionData {
    agentLogs: LogEntry; // This is the payload from the subscription
  }

  // --- Fetch Historical Logs ---
  const { loading: queryLoading, error: queryError, data: historicalData } = useQuery<{ agentLogs: string[] | null }>(GET_AGENT_LOGS_QUERY, {
    variables: { agentId },
    skip: !agentId,
    fetchPolicy: 'network-only', // Ensure it re-fetches when agent changes
  });

  // Effect to process historical logs once fetched
  useEffect(() => {
    // Only update loading state based on the query's loading status
    setHistoricalLogsLoading(queryLoading);
    if (queryError) {
      console.error("Error fetching historical logs:", queryError);
      setCombinedLogs([{ timestamp: new Date().toISOString(), stream: 'stderr', line: `Error fetching historical logs: ${queryError.message}` }]);
    } else if (historicalData?.agentLogs) {
      console.log("[AgentLogs] Historical logs received:", historicalData.agentLogs);
      const parsedHistoricalLogs: LogEntry[] = historicalData.agentLogs.map(logString => {
        const match = logString.match(/^\[(.*?)\] \[(stdout|stderr)\] (.*)$/s);
        if (match) {
          return { timestamp: match[1], stream: match[2] as 'stdout' | 'stderr', line: match[3] };
        }
        return { timestamp: new Date().toISOString(), stream: 'stderr', line: logString };
      });
      setCombinedLogs(parsedHistoricalLogs);
    } else if (!queryLoading && historicalData) {
      setCombinedLogs([]); // Clear logs if query finished with no data
    }
    // Clear logs and set loading when agentId changes
    return () => {
      setCombinedLogs([]);
      setHistoricalLogsLoading(true);
    };
  }, [agentId, queryLoading, queryError, historicalData]);


  // --- Subscribe to Real-time Logs ---
  useSubscription<AgentLogsSubscriptionData>(AGENT_LOGS_SUBSCRIPTION, {
    variables: { agentId },
    skip: !agentId || historicalLogsLoading, // Skip if no agent or historical logs are still loading
    onData: (options: OnDataOptions<AgentLogsSubscriptionData>) => {
      const newLogEntry = options.data.data?.agentLogs;
      if (newLogEntry) {
        console.log('[AgentLogs onData] Real-time log received:', newLogEntry);
        setCombinedLogs((prevLogs) => {
           const updatedLogs = [...prevLogs, newLogEntry];
           const maxLogs = 500; // Limit total combined logs
           if (updatedLogs.length > maxLogs) {
              return updatedLogs.slice(updatedLogs.length - maxLogs);
           }
           return updatedLogs;
        });
      }
    },
    onError: (err: ApolloError) => {
       console.error("Subscription error:", err);
       setCombinedLogs(prev => [...prev, { timestamp: new Date().toISOString(), stream: 'stderr', line: `Log stream error: ${err.message}` }]);
    }
  });

  // Scroll logs to bottom when new entries are added
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [combinedLogs]); // Depend on combinedLogs

  // Render only if agentId is provided
  if (!agentId) {
    return null; // Or a placeholder message
  }

  return (
       <div
         ref={logContainerRef}
         style={{
           height: '500px',
           overflowY: 'scroll',
           padding: '0',
           fontFamily: 'monospace',
           fontSize: '0.9em',
           borderRadius: '4px',
           textAlign: 'left',
           backgroundColor: '#333', // Dark background
           color: '#eee', // Light text
           border: '1px solid #555', // Dark border
         }}
       >
         {historicalLogsLoading ? (
           <p style={{ color: '#aaa' }}>Loading historical logs...</p>
         ) : combinedLogs.length === 0 ? (
           <p style={{ color: '#aaa' }}>No logs to display.</p>
         ) : (
           combinedLogs.map((log, index) => (
             <div key={index} style={{ color: log.stream === 'stderr' ? '#ff8a8a' : '#eee', marginBottom: '2px' }}>
               <span style={{ color: '#aaa', marginRight: '10px' }}>
                 {new Date(log.timestamp).toLocaleTimeString([], { hour12: false })} [{log.stream.toUpperCase()}]
               </span>
               {log.line}
             </div>
           ))
         )}
       </div>
  );
};

export default AgentLogs;
