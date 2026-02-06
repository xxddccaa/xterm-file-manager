import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// Debug: Check if root element exists
const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('❌ Root element not found!');
  document.body.innerHTML = '<div style="padding: 20px; color: red;">Error: Root element not found</div>';
} else {
  console.log('✅ Root element found, rendering app...');
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
