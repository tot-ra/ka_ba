import React, { useState, useContext } from 'react';
import axios from 'axios';
import { Container, Typography, Paper, TextField, Button, Box, CircularProgress, Alert, FormControlLabel, Checkbox, FormGroup, Grid } from '@mui/material';
import { useNavigate } from 'react-router-dom';
// Assuming AgentContext provides a way to refresh the agent list
// import { AgentContext } from '../contexts/AgentContext';

type SpawnMessageType = 'success' | 'error' | null;

// Minimal Agent interface needed here
interface Agent {
  id: string;
  url: string;
  name?: string;
  description?: string;
  isLocal: boolean;
}

const AddAgent: React.FC = () => {
  const navigate = useNavigate();
  // const { refreshAgents } = useContext(AgentContext); // Uncomment if using context

  // State for adding external agent
  const [newAgentUrl, setNewAgentUrl] = useState('');
  const [newAgentName, setNewAgentName] = useState('');

  // State for spawning local agent
  const [spawnAgentConfig, setSpawnAgentConfig] = useState({
    model: 'qwen3-30b-a3b',
    systemPrompt: 'You are an expert software engineer.',
    apiBaseUrl: 'http://192.168.1.205:1234',
    port: '',
    name: 'Software Engineer',
    description: 'An AI assistant specialized in software engineering tasks.',
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isSpawning, setIsSpawning] = useState(false);
  const [spawnStatusMessage, setSpawnStatusMessage] = useState<string | null>(null);
  const [spawnMessageType, setSpawnMessageType] = useState<SpawnMessageType>(null);
  const [isAddingExternal, setIsAddingExternal] = useState(false);
  const [addExternalStatusMessage, setAddExternalStatusMessage] = useState<string | null>(null);
  const [addExternalMessageType, setAddExternalMessageType] = useState<SpawnMessageType>(null);


  const handleAddAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsAddingExternal(true);
    setAddExternalStatusMessage(null);
    setAddExternalMessageType(null);
    console.log('Attempting to add agent:', newAgentUrl, 'with name:', newAgentName);
    try {
      const response = await axios.post('http://localhost:3000/graphql', {
        query: `
          mutation AddAgent($url: String!, $name: String) {
            addAgent(url: $url, name: $name) {
              id
              url
              name
              description
              isLocal
            }
          }
        `,
        variables: {
          url: newAgentUrl,
          name: newAgentName || null,
        },
      });
      const newAgent = response.data.data.addAgent;
      if (newAgent && newAgent.id) {
        console.log('Agent added successfully:', newAgent);
        setAddExternalStatusMessage(`External agent "${newAgent.name || newAgent.id}" added successfully.`);
        setAddExternalMessageType('success');
        setNewAgentUrl('');
        setNewAgentName('');
        // refreshAgents?.(); // Refresh list in parent if using context
        // Optionally navigate back after success
        // setTimeout(() => navigate('/agents'), 1500);
      } else {
        const errorMessage = response.data.errors?.[0]?.message || 'Failed to add agent or received invalid data.';
        console.error('Failed to add agent:', newAgentUrl, newAgentName, response.data);
        setAddExternalStatusMessage(`Error: ${errorMessage}`);
        setAddExternalMessageType('error');
      }
    } catch (error: any) {
      console.error('Error adding agent:', error);
      const message = error.response?.data?.errors?.[0]?.message || error.message || 'An unknown error occurred.';
      setAddExternalStatusMessage(`Error: ${message}`);
      setAddExternalMessageType('error');
    } finally {
      setIsAddingExternal(false);
    }
  };

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
        setSpawnStatusMessage(`Agent "${spawnedAgent.name || spawnedAgent.id}" spawned successfully at ${spawnedAgent.url}.`);
        setSpawnMessageType('success');
        // refreshAgents?.(); // Refresh list in parent if using context
        setSpawnAgentConfig({ // Reset form
          model: 'qwen3-30b-a3b',
          systemPrompt: 'You are a helpful assistant.',
          apiBaseUrl: 'http://192.168.1.205:1234',
          port: '',
          name: '',
          description: '',
        });
        // Optionally navigate back after success
        // setTimeout(() => navigate('/agents'), 1500);
      } else {
        const errorMessage = response.data.errors?.[0]?.message || 'Failed to spawn agent or received invalid data.';
        console.error('Failed to spawn agent:', spawnAgentConfig, response.data);
        setSpawnStatusMessage(`Error: ${errorMessage}`);
        setSpawnMessageType('error');
      }
    } catch (error: any) {
      console.error('Error spawning agent:', error);
      const message = error.response?.data?.errors?.[0]?.message || error.message || 'An unknown error occurred.';
      setSpawnStatusMessage(`Error: ${message}`);
      setSpawnMessageType('error');
    } finally {
      setIsSpawning(false);
    }
  };

  return (
    <Container maxWidth="md">
      <Button onClick={() => navigate('/agents')} sx={{ mt: 2, mb: 1 }}>
        &larr; Back to Agent Management
      </Button>
      <Paper sx={{ p: 3, mt: 1 }}>
        <Typography variant="h4" gutterBottom sx={{ mb: 3 }}>
          Add New Agent
        </Typography>

        {/* Section for Spawning Local Agent */}
        <Box component="form" onSubmit={handleSpawnAgent} sx={{ mb: 5, border: '1px solid #e0e0e0', p: 3, borderRadius: 1 }}>
          <Typography variant="h5" gutterBottom>Spawn Local 'ka' Agent</Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TextField
                fullWidth
                label="Agent Name (Optional)"
                id="spawnName"
                name="name"
                placeholder="Coder Assistant"
                value={spawnAgentConfig.name}
                onChange={(e) => setSpawnAgentConfig({ ...spawnAgentConfig, name: e.target.value })}
                variant="outlined"
                size="small"
              />
            </Grid>
             <Grid item xs={12}>
               <TextField
                 fullWidth
                 label="Agent Description (Optional)"
                 id="spawnDescription"
                 name="description"
                 placeholder="Describe the agent's purpose or specialization"
                 value={spawnAgentConfig.description}
                 onChange={(e) => setSpawnAgentConfig({ ...spawnAgentConfig, description: e.target.value })}
                 multiline
                 rows={2}
                 variant="outlined"
                 size="small"
               />
            </Grid>
            <Grid item xs={12}>
              <TextField
                fullWidth
                label="System Prompt"
                id="systemPrompt"
                name="systemPrompt"
                value={spawnAgentConfig.systemPrompt}
                onChange={(e) => setSpawnAgentConfig({ ...spawnAgentConfig, systemPrompt: e.target.value })}
                multiline
                rows={3}
                variant="outlined"
                size="small"
              />
            </Grid>

            <Grid item xs={12}>
              <FormGroup>
                <FormControlLabel
                  control={<Checkbox checked={showAdvanced} onChange={(e) => setShowAdvanced(e.target.checked)} size="small" />}
                  label="Show Advanced Properties"
                />
              </FormGroup>
            </Grid>

            {showAdvanced && (
              <>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="LLM Model"
                    id="model"
                    name="model"
                    value={spawnAgentConfig.model}
                    onChange={(e) => setSpawnAgentConfig({ ...spawnAgentConfig, model: e.target.value })}
                    variant="outlined"
                    size="small"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="API Base URL"
                    id="apiBaseUrl"
                    name="apiBaseUrl"
                    value={spawnAgentConfig.apiBaseUrl}
                    onChange={(e) => setSpawnAgentConfig({ ...spawnAgentConfig, apiBaseUrl: e.target.value })}
                    variant="outlined"
                    size="small"
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    fullWidth
                    label="Agent Port (leave empty for random)"
                    id="port"
                    name="port"
                    placeholder="e.g., 8081"
                    value={spawnAgentConfig.port}
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value === '' || /^\d+$/.test(value)) {
                        setSpawnAgentConfig({ ...spawnAgentConfig, port: value });
                      }
                    }}
                    variant="outlined"
                    size="small"
                  />
                </Grid>
              </>
            )}

            {spawnStatusMessage && (
              <Grid item xs={12}>
                <Alert severity={spawnMessageType || 'info'}>{spawnStatusMessage}</Alert>
              </Grid>
            )}

            <Grid item xs={12}>
              <Button
                type="submit"
                variant="contained"
                color="primary"
                disabled={isSpawning}
                startIcon={isSpawning ? <CircularProgress size={20} color="inherit" /> : null}
              >
                {isSpawning ? 'Spawning...' : 'Spawn Agent'}
              </Button>
            </Grid>
          </Grid>
        </Box>

        {/* Section for Adding External Agent */}
        <Box component="form" onSubmit={handleAddAgent} sx={{ border: '1px solid #e0e0e0', p: 3, borderRadius: 1 }}>
           <Typography variant="h5" gutterBottom>Add External Agent</Typography>
           <Grid container spacing={2} alignItems="flex-end">
             <Grid item xs={12} sm={4}>
                <TextField
                  fullWidth
                  label="Agent Name (Optional)"
                  id="externalAgentName"
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  variant="outlined"
                  size="small"
                />
             </Grid>
             <Grid item xs={12} sm={6}>
               <TextField
                 fullWidth
                 required
                 label="Agent URL"
                 id="externalAgentUrl"
                 placeholder="http://..."
                 value={newAgentUrl}
                 onChange={(e) => setNewAgentUrl(e.target.value)}
                 variant="outlined"
                 size="small"
               />
             </Grid>
             <Grid item xs={12} sm={2}>
               <Button
                 fullWidth
                 type="submit"
                 variant="contained"
                 color="secondary"
                 disabled={isAddingExternal}
                 startIcon={isAddingExternal ? <CircularProgress size={20} color="inherit" /> : null}
               >
                 {isAddingExternal ? 'Adding...' : 'Add Agent'}
                </Button>
             </Grid>
             {addExternalStatusMessage && (
               <Grid item xs={12}>
                 <Alert severity={addExternalMessageType || 'info'}>{addExternalStatusMessage}</Alert>
               </Grid>
             )}
           </Grid>
        </Box>

      </Paper>
    </Container>
  );
};

export default AddAgent;
