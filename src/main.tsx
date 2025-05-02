import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App'; // Removed .tsx extension
import './index.css'; // Assuming a basic index.css might be needed

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
