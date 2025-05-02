import React, { useState } from 'react';
import axios from 'axios';
import { Container, Typography, Paper, TextField, Button, Box, CircularProgress, Alert, Grid } from '@mui/material';
import { useNavigate } from 'react-router-dom';

type AddExternalMessageType = 'success' | 'error' | null;

const AddExternalAgent: React.FC = () => {
  const navigate = useNavigate();

  const [newAgentUrl, setNewAgentUrl] = useState('');
  const [newAgentName, setNewAgentName] = useState('');
  const [isAddingExternal, setIsAddingExternal] = useState(false);
  const [addExternalStatusMessage, setAddExternalStatusMessage] = useState<string | null>(null);
  const [addExternalMessageType, setAddExternalMessageType] = useState<AddExternalMessageType>(null);

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
        setAddExternalStatusMessage(`External agent "${newAgent.name || newAgent.id}" added successfully. Redirecting...`);
        setAddExternalMessageType('success');
        // Navigate back after a short delay
        setTimeout(() => navigate('/agents'), 1500);
      } else {
        const errorMessage = response.data.errors?.[0]?.message || 'Failed to add agent or received invalid data.';
        console.error('Failed to add agent:', newAgentUrl, newAgentName, response.data);
        setAddExternalStatusMessage(`Error: ${errorMessage}`);
        setAddExternalMessageType('error');
        setIsAddingExternal(false); // Stop loading on error
      }
    } catch (error: any) {
      console.error('Error adding agent:', error);
      const message = error.response?.data?.errors?.[0]?.message || error.message || 'An unknown error occurred.';
      setAddExternalStatusMessage(`Error: ${message}`);
      setAddExternalMessageType('error');
      setIsAddingExternal(false); // Stop loading on error
    }
     // Don't set isAddingExternal to false on success, as we are navigating away
  };

  return (
    <Container maxWidth="md">
       <Button onClick={() => navigate('/agents')} sx={{ mt: 2, mb: 1 }}>
         &larr; Back to Agent Management
       </Button>
      <Paper sx={{ p: 3, mt: 1 }}>
        <Typography variant="h4" gutterBottom sx={{ mb: 3 }}>
          Add External Agent
        </Typography>

        <Box component="form" onSubmit={handleAddAgent} sx={{ border: '1px solid #e0e0e0', p: 3, borderRadius: 1 }}>
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

export default AddExternalAgent;
