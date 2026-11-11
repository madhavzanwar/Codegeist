import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { enableTheme, getModuleKey } from './api';
import { Dashboard } from './views/Dashboard';
import { IssuePanel } from './views/IssuePanel';
import { ConfluenceOverview } from './views/ConfluenceOverview';
import './styles.css';

function App() {
  const [moduleKey, setModuleKey] = useState<string | null>(null);
  useEffect(() => {
    void enableTheme();
    void getModuleKey().then(setModuleKey);
  }, []);
  if (moduleKey === null) return null;
  if (moduleKey.includes('issue-panel')) return <IssuePanel />;
  if (moduleKey.includes('confluence')) return <ConfluenceOverview />;
  return <Dashboard />;
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
