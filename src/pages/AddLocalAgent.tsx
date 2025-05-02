import React, { useState, useEffect } from 'react'; // Import useEffect
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import styles from './AddLocalAgent.module.css'; // Import CSS module

type SpawnMessageType = 'success' | 'error' | null;

const AddLocalAgent: React.FC = () => {
  const navigate = useNavigate();

  const [spawnAgentConfig, setSpawnAgentConfig] = useState({
    model: 'qwen3-30b-a3b',
    systemPrompt: 'You are an expert software engineer.',
    apiBaseUrl: 'http://localhost:1234',
    port: '',
    name: 'Software Engineer',
    description: 'An AI assistant specialized in software engineering tasks.',
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSpawning, setIsSpawning] = useState(false);
  const [spawnStatusMessage, setSpawnStatusMessage] = useState<string | null>(null);
  const [spawnMessageType, setSpawnMessageType] = useState<SpawnMessageType>(null);
  const [spawnedAgentId, setSpawnedAgentId] = useState<string | null>(null); // State for agent ID
  const [agentLogs, setAgentLogs] = useState<string[]>([]); // State for logs
  const [isFetchingLogs, setIsFetchingLogs] = useState(false); // State for log fetching status

  const handleSpawnAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSpawning(true);
    setSpawnStatusMessage(null);
    setSpawnMessageType(null);
    console.log('Attempting to spawn agent with config:', spawnAgentConfig);

    const variables = {
      ...spawnAgentConfig,
      port: spawnAgentConfig.port ? parseInt(spawnAgentConfig.port.toString(), 10) : null,
      name: spawnAgentConfig.name || null,
      description: spawnAgentConfig.description || null,
    };
    console.log('Variables being sent:', variables);

    try {
      const response = await axios.post('http://localhost:3000/graphql', {
        query: `
          mutation SpawnKaAgent($model: String, $systemPrompt: String, $apiBaseUrl: String, $port: Int, $name: String, $description: String) {
            spawnKaAgent(model: $model, systemPrompt: $systemPrompt, apiBaseUrl: $apiBaseUrl, port: $port, name: $name, description: $description) {
              id
              url
              name
              description
              isLocal
            }
          }
        `,
        variables: variables,
      });
      const spawnedAgent = response.data.data.spawnKaAgent;
      if (spawnedAgent && spawnedAgent.id) {
        console.log('Agent spawned successfully:', spawnedAgent);
        setSpawnedAgentId(spawnedAgent.id); // Store the ID
        setSpawnStatusMessage(`Agent "${spawnedAgent.name || spawnedAgent.id}" spawned successfully at ${spawnedAgent.url}. Fetching initial logs...`);
        setSpawnMessageType('success');
        setIsSpawning(false); // Stop initial spawning indicator
        setIsFetchingLogs(true); // Start log fetching indicator

        // Fetch logs using GraphQL
        try {
          const logResponse = await axios.post('http://localhost:3000/graphql', {
            query: `
              query AgentLogs($agentId: ID!) {
                agentLogs(agentId: $agentId)
              }
            `,
            variables: { agentId: spawnedAgent.id },
          });

          const logs = logResponse.data.data.agentLogs;
          if (logs) {
            setAgentLogs(logs);
            setSpawnStatusMessage(`Agent "${spawnedAgent.name || spawnedAgent.id}" spawned successfully at ${spawnedAgent.url}. Logs retrieved.`); // Update status
          } else {
             // Handle case where logs might be null (e.g., agent stopped quickly)
             console.warn(`Received null logs for agent ${spawnedAgent.id}.`);
             setAgentLogs([]); // Set to empty array
             setSpawnStatusMessage(`Agent "${spawnedAgent.name || spawnedAgent.id}" spawned successfully at ${spawnedAgent.url}. No logs available yet.`);
          }
        } catch (logError: any) {
          const errorMessage = logError.response?.data?.errors?.[0]?.message || logError.message || 'Unknown error fetching logs.';
          console.error(`Error fetching logs for agent ${spawnedAgent.id}:`, errorMessage);
          setSpawnStatusMessage(`Agent spawned, but failed to fetch logs: ${logError.message}`);
          setSpawnMessageType('error'); // Show error for log fetching failure
        } finally {
          setIsFetchingLogs(false); // Stop log fetching indicator
        }

      } else {
        const errorMessage = response.data.errors?.[0]?.message || 'Failed to spawn agent or received invalid data.';
        console.error('Failed to spawn agent:', spawnAgentConfig, response.data);
        setSpawnStatusMessage(`Error: ${errorMessage}`);
        setSpawnMessageType('error');
        setIsSpawning(false); // Stop loading on error
      }
    } catch (error: any) {
      console.error('Error spawning agent:', error);
      const message = error.response?.data?.errors?.[0]?.message || error.message || 'An unknown error occurred.';
      setSpawnStatusMessage(`Error: ${message}`);
      setSpawnMessageType('error');
      setIsSpawning(false); // Stop loading on spawn error
    }
    // Keep isSpawning false unless actively spawning or fetching logs
  };

  return (
    <div className={styles.container}>
      {/* Back button removed */}
      <div className={styles.paper}>
        <h1 className={styles.title}>
          Spawn Local 'ka' Agent
        </h1>

        <form onSubmit={handleSpawnAgent} className={styles.form}>
          <div className={styles.formGrid}>
            {/* Agent Name */}
            <div className={styles.formField}>
              <label htmlFor="spawnName" className={styles.formLabel}>Agent Name (Optional)</label>
              <input
                type="text"
                id="spawnName"
                name="name"
                placeholder="Coder Assistant"
                value={spawnAgentConfig.name}
                onChange={(e) => setSpawnAgentConfig({ ...spawnAgentConfig, name: e.target.value })}
                className={styles.formInput}
              />
            </div>

            {/* Agent Description */}
            <div className={styles.formField}>
              <label htmlFor="spawnDescription" className={styles.formLabel}>Agent Description (Optional)</label>
              <textarea
                 id="spawnDescription"
                 name="description"
                 placeholder="Describe the agent's purpose or specialization"
                 value={spawnAgentConfig.description}
                 onChange={(e) => setSpawnAgentConfig({ ...spawnAgentConfig, description: e.target.value })}
                 rows={16}
                 className={styles.formTextarea}
              />
            </div>

            {/* System Prompt */}
            <div className={styles.formField}>
              <label htmlFor="systemPrompt" className={styles.formLabel}>System Prompt</label>
              <textarea
                id="systemPrompt"
                name="systemPrompt"
                value={spawnAgentConfig.systemPrompt}
                onChange={(e) => setSpawnAgentConfig({ ...spawnAgentConfig, systemPrompt: e.target.value })}
                rows={8}
                className={styles.formTextarea}
              />
              <p className={styles.captionText}>
                Note: This prompt will be injected into every task sent to this agent.
              </p>
            </div>

            {/* Show Advanced Checkbox */}
            <div className={styles.checkboxGroup}>
              <label htmlFor="showAdvanced" className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  id="showAdvanced"
                  checked={showAdvanced}
                  onChange={(e) => setShowAdvanced(e.target.checked)}
                  className={styles.checkboxInput}
                />
                Show Advanced Properties
              </label>
            </div>

            {/* Conditionally render advanced options */}
            {showAdvanced && (
              <>
                {/* LLM Model */}
                <div className={styles.formField}>
                  <label htmlFor="model" className={styles.formLabel}>LLM Model</label>
                  <input
                    type="text"
                    id="model"
                    name="model"
                    value={spawnAgentConfig.model}
                    onChange={(e) => setSpawnAgentConfig({ ...spawnAgentConfig, model: e.target.value })}
                    className={styles.formInput}
                  />
                </div>

                {/* API Base URL */}
                <div className={styles.formField}>
                  <label htmlFor="apiBaseUrl" className={styles.formLabel}>API Base URL</label>
                  <input
                    type="text"
                    id="apiBaseUrl"
                    name="apiBaseUrl"
                    value={spawnAgentConfig.apiBaseUrl}
                    onChange={(e) => setSpawnAgentConfig({ ...spawnAgentConfig, apiBaseUrl: e.target.value })}
                    className={styles.formInput}
                  />
                </div>

                {/* Agent Port */}
                <div className={styles.formField}>
                  <label htmlFor="port" className={styles.formLabel}>Agent Port (leave empty for random)</label>
                  <input
                    type="text" // Keep as text to allow empty string, validation handles number conversion
                    id="port"
                    name="port"
                    placeholder="e.g., 8081"
                    value={spawnAgentConfig.port}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Allow only digits or empty string
                      if (value === '' || /^\d*$/.test(value)) {
                        setSpawnAgentConfig({ ...spawnAgentConfig, port: value });
                      }
                    }}
                    className={styles.formInput}
                  />
                </div>
              </>
            )}

            {/* Status Message */}
            {spawnStatusMessage && (
              <div className={`${styles.alert} ${spawnMessageType === 'success' ? styles.alertSuccess : spawnMessageType === 'error' ? styles.alertError : styles.alertInfo}`}>
                {spawnStatusMessage}
              </div>
            )}

            {/* Submit Button */}
            <div className={styles.formField}>
              <button
                type="submit"
                className={`${styles.button} ${styles.buttonPrimary}`}
                disabled={isSpawning}
              >
                {isSpawning && <div className={styles.spinner}></div>}
                {isSpawning ? 'Spawning...' : 'Spawn Agent'}
              </button>
            </div>
          </div>
        </form>

        {/* Log Display Area */}
        {spawnedAgentId && agentLogs.length > 0 && (
          <div className={styles.logContainer}>
            <h2 className={styles.logTitle}>Agent Logs (Last 100 lines)</h2>
            <pre className={styles.logPre}>
              {agentLogs.map((log, index) => (
                <div key={index}>{log}</div>
              ))}
            </pre>
            <button
              onClick={() => navigate('/agents')}
              className={`${styles.button} ${styles.buttonSecondary}`}
              style={{ marginTop: '1rem' }} // Add some spacing
            >
              Go Back to Agent List
            </button>
          </div>
        )}
        {/* Show spinner while fetching logs */}
        {isFetchingLogs && (
           <div className={styles.spinnerContainer}>
             <div className={styles.spinner}></div>
             <p>Fetching logs...</p>
           </div>
        )}
      </div>
    </div>
  );
};

export default AddLocalAgent;
