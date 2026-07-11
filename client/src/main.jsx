import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { redirectIfCustomDomain } from './lib/hostRedirect.js';
import './styles.css';

// Run before mounting the router: if we're on the custom domain the visitor
// is about to be navigated away entirely, so there's no point paying for a
// React render first (see hostRedirect.js for why this redirect exists).
redirectIfCustomDomain();

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {/* Deployment invariant (PLAN.md §部署): app is served under
        dokipoki-dev.web.app/merchant, so the router must know its routes
        live under that prefix — matches Vite's base: '/merchant/'. */}
    <BrowserRouter basename="/merchant">
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
