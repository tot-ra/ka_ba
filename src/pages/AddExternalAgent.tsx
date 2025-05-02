import React, { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import styles from './AddExternalAgent.module.css'; // Import the new CSS module

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

  // Helper to get alert class based on type
  const getAlertClass = (type: AddExternalMessageType): string => {
    if (type === 'success') return styles.alertSuccess;
    if (type === 'error') return styles.alertError;
    return styles.alertInfo; // Default or null
  };

  return (
    <div className={styles.container}>
       <button onClick={() => navigate('/agents')} className={`${styles.button} ${styles.buttonBack}`}>
         &larr; Back to Agent Management
       </button>
      <div className={styles.paper}>
        <h1 className={styles.title}>
          Add External Agent
        </h1>

        <form onSubmit={handleAddAgent} className={styles.form}>
           <div className={styles.formGrid}>
             {/* Agent Name Field */}
             <div className={`${styles.formField} ${styles.formFieldName}`}>
                <label htmlFor="externalAgentName" className={styles.formLabel}>Agent Name (Optional)</label>
                <input
                  type="text"
                  id="externalAgentName"
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  className={styles.formInput}
                />
             </div>
             {/* Agent URL Field */}
             <div className={`${styles.formField} ${styles.formFieldUrl}`}>
               <label htmlFor="externalAgentUrl" className={styles.formLabel}>Agent URL</label>
               <input
                 type="url" // Use type="url" for better semantics/validation
                 required
                 id="externalAgentUrl"
                 placeholder="http://..."
                 value={newAgentUrl}
                 onChange={(e) => setNewAgentUrl(e.target.value)}
                 className={styles.formInput}
               />
             </div>
             {/* Submit Button */}
             <div className={`${styles.formField} ${styles.formFieldButton}`}>
               {/* Add an empty label for alignment if needed, or adjust CSS */}
               <label className={styles.formLabel}>&nbsp;</label>
               <button
                 type="submit"
                 className={`${styles.button} ${styles.buttonPrimary}`}
                 disabled={isAddingExternal || !newAgentUrl} // Also disable if URL is empty
               >
                 {isAddingExternal && <div className={styles.spinner}></div>}
                 {isAddingExternal ? 'Adding...' : 'Add Agent'}
                </button>
             </div>
             {/* Status Message */}
             {addExternalStatusMessage && (
               <div className={`${styles.formField} ${styles.formFieldFull}`}>
                 <div className={`${styles.alert} ${getAlertClass(addExternalMessageType)}`}>
                   {addExternalStatusMessage}
                 </div>
               </div>
             )}
           </div>
        </form>
      </div>
    </div>
  );
};

export default AddExternalAgent;
