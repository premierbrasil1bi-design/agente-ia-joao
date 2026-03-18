import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AgentAuthProvider } from './context/AgentAuthContext';
import { ChannelProvider } from './context/ChannelContext';
import App from './App';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AgentAuthProvider>
        <ChannelProvider>
          <>
            <App />
            <Toaster position="top-right" />
          </>
        </ChannelProvider>
      </AgentAuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
