import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

import './styles/base.css';
import './styles/layout.css';
import './styles/components.css';
import './styles/detail.css';
import './styles/diary.css';
import './styles/settings.css';

const root = document.getElementById('root');
if (!root) throw new Error('No #root element to mount into.');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
