import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Icon } from './ui.jsx';
import Students from './Students.jsx';
import Log from './Log.jsx';
import RealEstate from './RealEstate.jsx';
import Hospital from './Hospital.jsx';

const TABS = [
  ['students', 'Students', 'users', 'Academic records & fee collection'],
  ['realestate', 'Real estate', 'wallet', 'Property, tenancy & installments'],
  ['hospital', 'Hospital', 'alert', 'Pharmacy, prescriptions & stock alerts'],
  ['log', 'Message centre', 'msg', 'WhatsApp delivery & communication'],
];

export default function App() {
  const [config, setConfig] = useState({ institute: 'Fee Portal', dryRun: true });
  const [tab, setTab] = useState('students');

  useEffect(() => {
    api('/config').then(setConfig).catch(() => {});
  }, []);

  const current = TABS.find(([key]) => key === tab) || TABS[0];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Icon name="card" size={21} /></div>
          <div className="brand-copy">
            <strong>{config.institute}</strong>
            <span>Management workspace</span>
          </div>
        </div>

        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {TABS.map(([key, label, icon, description]) => (
            <button key={key} className={`sidebar-link ${tab === key ? 'active' : ''}`}
              onClick={() => setTab(key)}>
              <span className="sidebar-link-icon"><Icon name={icon} size={18} /></span>
              <span className="sidebar-link-copy"><strong>{label}</strong><small>{description}</small></span>
              {tab === key && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className={`connection-card ${config.dryRun ? 'is-test' : 'is-live'}`}>
            <span className="connection-dot" />
            <div>
              <strong>{config.dryRun ? 'WhatsApp test mode' : 'WhatsApp connected mode'}</strong>
              <p>{config.dryRun ? 'Messages are simulated. No message will be delivered.' : 'Message sending is enabled.'}</p>
            </div>
          </div>
          <div className="sidebar-version">FEE PORTAL <span>•</span> WORKSPACE</div>
        </div>
      </aside>

      <main className="workspace">
        <header className="workspace-topbar">
          <div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{current[1]}</strong></div>
          <div className="topbar-meta"><span className="topbar-status" />Local workspace</div>
        </header>
        <div className="workspace-content">
          <div className="module-context">
            <div><span className="eyebrow">ROLE-FOCUSED OPERATIONS</span><p>{current[3]}</p></div>
            <div className="module-date">{new Date().toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</div>
          </div>
          <div key={tab} className="module-page">
            {tab === 'students' ? <Students /> : tab === 'log' ? <Log /> : tab === 'hospital' ? <Hospital /> : <RealEstate />}
          </div>
        </div>
      </main>
    </div>
  );
}
