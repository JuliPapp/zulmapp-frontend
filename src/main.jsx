import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// Render con StrictMode para detectar efectos secundarios y avisos de React
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
