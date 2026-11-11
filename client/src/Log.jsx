import { useEffect, useState } from 'react';
import { api } from './api.js';
import { Icon } from './ui.jsx';

const fmtWhen = (at) => {
  if (!at) return '';
  const d = new Date(at.replace(' ', 'T') + 'Z');
  return isNaN(d)
    ? at
    : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};

export default function Log() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('ALL');

  useEffect(() => {
    api('/log').then(setRows).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const sent = rows.filter((r) => r.ok).length;
  const failed = rows.length - sent;
  const shown = rows.filter((r) => {
    const matchesFilter = filter === 'ALL' || (filter === 'SENT' ? !!r.ok : !r.ok);
    const haystack = `${r.name || ''} ${r.to_number || ''} ${r.kind || ''} ${r.detail || ''}`.toLowerCase();
    return matchesFilter && haystack.includes(query.toLowerCase());
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Message log</h1>
          <p className="muted">History of the last 200 WhatsApp messages</p>
        </div>
      </div>

      <section className="panel">
        <div className="toolbar">
          <div className="chips">
            {[['ALL', 'All activity', rows.length], ['SENT', 'Sent / test', sent], ['FAILED', 'Failed', failed]].map(([key, label, count]) => (
              <button key={key} className={`chip ${filter === key ? 'on' : ''}`} onClick={() => setFilter(key)}>{label}<b>{count}</b></button>
            ))}
          </div>
          <div className="search"><Icon name="search" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search recipient, number or message type" /></div>
        </div>

        <div className="tw">
          <table>
            <thead>
              <tr><th>Date & time</th><th>Recipient</th><th>WhatsApp number</th><th>Message purpose</th><th>Delivery result</th></tr>
            </thead>
            <tbody>
              {loading && [0, 1, 2].map((i) => (
                <tr key={i}>{[0, 1, 2, 3, 4].map((j) => <td key={j}><div className="skel" style={{ width: '70%' }} /></td>)}</tr>
              ))}
              {!loading && shown.map((r, i) => (
                <tr key={r.id} className="rowin" style={{ '--i': Math.min(i, 14) }}>
                  <td className="muted">{fmtWhen(r.at)}</td>
                  <td><strong>{r.name || '—'}</strong><span className="sub">WhatsApp recipient</span></td>
                  <td>{r.to_number}</td>
                  <td><strong>{String(r.kind || 'Message').toLowerCase().replaceAll('_', ' ')}</strong><span className="sub">{r.detail || 'No provider detail returned'}</span></td>
                  <td>
                    <span className={`pill ${r.ok ? 'paid' : 'failed'}`}><i className="dot" />{r.ok ? 'sent' : 'failed'}</span>
                    {!r.ok && r.detail && <span className="sub">{r.detail}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!loading && !shown.length && (
            <div className="empty">
              <div className="ico"><Icon name="msg" size={26} /></div>
              <strong>{rows.length ? 'No matching messages' : 'Nothing sent yet'}</strong>
              <div className="muted">{rows.length ? 'Adjust your search or result filter.' : 'Delivery confirmations, reminders and errors will appear here.'}</div>
            </div>
          )}
        </div>
      </section>
    </>
  );
}