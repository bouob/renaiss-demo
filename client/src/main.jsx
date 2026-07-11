import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { redirectIfCustomDomain } from './lib/hostRedirect.js';
import './i18n/index.js';
import './styles.css';

// Path mode only: bounce merchant.dokipoki.app → dokipoki-dev…/merchant/
// Root multi-site (base '/') must NOT bounce — the custom domain IS the app.
redirectIfCustomDomain();

// Vite BASE_URL is '/merchant/' or '/' depending on MERCHANT_BASE.
const rawBase = import.meta.env.BASE_URL || '/';
const routerBasename = rawBase === '/' ? undefined : rawBase.replace(/\/$/, '');

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBasename}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
