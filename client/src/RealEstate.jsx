import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './ui.jsx';

const money = (n) => Number(n || 0).toLocaleString('en-PK');
const pad = (n) => String(n).padStart(2, '0');
const thisMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fmtDate = (d) => {
  if (!d) return '—';
  const x = new Date(d + 'T00:00:00');
  return isNaN(x)
    ? d
    : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const fmtWhen = (at) => {
  if (!at) return '';
  const d = new Date(at.replace(' ', 'T') + 'Z');
  return isNaN(d)
    ? at
    : d.toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};
const avatarBg = (id) => {
  const h = (Number(id) * 47) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 45) % 360} 70% 42%))`;
};
const initials = (n = '') =>
  n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const blank = () => ({
  kind: 'INSTALLMENT',
  property: '',
  property_type: 'Residential',
  property_address: '',
  contract_ref: '',
  start_date: '',
  end_date: '',
  security_deposit: '',
  notes: '',
  client_name: '',
  phone: '',
  monthly_amount: '',
  months: '12',
  start_month: thisMonth(),
});

function CountUp({ value }) {
  const [n, setN] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    const b = Math.round(Number(value) || 0);
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - start) / 900);
      const e = 1 - Math.pow(1 - p, 3);
      setN(Math.round(a + (b - a) * e));
      if (p < 1) raf = requestAnimationFrame(tick);
      else from.current = b;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{n.toLocaleString()}</>;
}

export default function RealEstate() {
  const [rows, setRows] = useState([]);
  const [msgs, setMsgs] = useState([]);
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [drawer, setDrawer] = useState(null); // { id: number | null }
  const [form, setForm] = useState(blank());
  const [formErr, setFormErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null); // contract whose payments are open
  const [pays, setPays] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [toast, setToast] = useState(null);
  const timer = useRef();

  const notify = (text, type = 'ok') => {
    clearTimeout(timer.current);
    setToast({ text, type, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), 3600);
  };

  const load = () =>
    Promise.all([api('/realestate/contracts'), api('/realestate/log')])
      .then(([c, l]) => {
        setRows(c.rows);
        setDryRun(c.dryRun);
        setMsgs(l);
      })
      .catch((e) => notify(e.message, 'err'))
      .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const loadPays = (id) =>
    api(`/realestate/contracts/${id}/payments`)
      .then(setPays)
      .catch((e) => notify(e.message, 'err'));

  useEffect(() => {
    const h = (e) => {
      if (e.key !== 'Escape') return;
      if (confirmState) setConfirmState(null);
      else if (drawer) setDrawer(null);
      else if (view) setView(null);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [confirmState, drawer, view]);

  const act = async (fn, ok) => {
    try {
      await fn();
      if (ok) notify(ok);
      load();
    } catch (e) {
      notify(e.message, 'err');
    }
  };

  /* ----- add / edit ----- */
  const openAdd = () => { setForm(blank()); setFormErr(false); setDrawer({ id: null }); };
  const openEdit = (c) => {
    setForm({
      kind: c.kind,
      property: c.property,
      property_type: c.property_type || 'Residential',
      property_address: c.property_address || '',
      contract_ref: c.contract_ref || '',
      start_date: c.start_date || '',
      end_date: c.end_date || '',
      security_deposit: c.security_deposit ?? '',
      notes: c.notes || '',
      client_name: c.client_name,
      phone: c.phone || '',
      monthly_amount: String(c.monthly_amount),
      months: c.months ? String(c.months) : '12',
      start_month: c.start_month,
    });
    setFormErr(false);
    setDrawer({ id: c.id });
  };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    const amount = Number(form.monthly_amount);
    const months = Number(form.months);
    if (!form.client_name.trim() || !form.property.trim()) {
      setFormErr(true);
      notify('Client name and property are required.', 'err');
      return;
    }
    if (!(amount > 0)) { notify('Enter the monthly amount.', 'err'); return; }
    if (form.kind === 'INSTALLMENT' && !(months >= 1)) {
      notify('Enter the number of months.', 'err');
      return;
    }
    setSaving(true);
    const body = {
      ...form,
      monthly_amount: amount,
      months: form.kind === 'INSTALLMENT' ? months : null,
    };
    try {
      if (drawer.id) await api(`/realestate/contracts/${drawer.id}`, 'PUT', body);
      else await api('/realestate/contracts', 'POST', body);
      notify(drawer.id ? 'Contract updated.' : 'Contract added. Payment schedule created.');
      setDrawer(null);
      load();
    } catch (err) {
      notify(err.message, 'err');
    }
    setSaving(false);
  }

  /* ----- payments ----- */
  const openPays = (c) => { setView(c); setPays([]); loadPays(c.id); };
  async function setPaid(p, paid) {
    try {
      await api(`/realestate/payments/${p.id}/${paid ? 'paid' : 'unpaid'}`, 'POST');
      notify(paid ? 'Payment recorded. Receipt sent.' : 'Payment marked as pending again.');
      await loadPays(view.id);
      load();
    } catch (e) {
      notify(e.message, 'err');
    }
  }

  const runAlerts = () => setConfirmState({
    title: 'Send month-end alerts now?',
    text: 'Everyone with a payment due this month or earlier gets a WhatsApp message.',
    confirmLabel: 'Send alerts',
    onOk: async () => {
      setBusy(true);
      try {
        const r = await api('/realestate/alerts/run', 'POST', {});
        notify(`Alerts sent: ${r.sent}.`);
        load();
      } catch (e) {
        notify(e.message, 'err');
      }
      setBusy(false);
    },
  });

  /* ----- derived ----- */
  const sum = (k) => rows.reduce((t, c) => t + (Number(c[k]) || 0), 0);
  const active = rows.filter((c) => c.status === 'ACTIVE');
  const overdueRows = rows.filter((c) => c.overdue_count > 0);
  const counts = {
    '': rows.length,
    INSTALLMENT: rows.filter((c) => c.kind === 'INSTALLMENT').length,
    RENT: rows.filter((c) => c.kind === 'RENT').length,
    OVERDUE: overdueRows.length,
  };
  const shown = rows.filter((c) =>
    (!filter ||
      (filter === 'OVERDUE' ? c.overdue_count > 0 : c.kind === filter)) &&
    (!q ||
      `${c.client_name}${c.phone}${c.property}${c.property_address || ''}${c.contract_ref || ''}`.toLowerCase().includes(q.toLowerCase())));
  const viewRow = view ? rows.find((r) => r.id === view.id) || view : null;
  const today = todayStr();

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Real estate</h1>
          <p className="muted">
            Installment plans and monthly rent. Buyers and tenants get a message on the last day of each month.
          </p>
        </div>
        <div className="head-actions">
          <button className="btn ghost" disabled={busy} onClick={runAlerts}>
            {busy ? <span className="spin" /> : <Icon name="send" />}
            {busy ? 'Sending…' : 'Send month-end alerts'}
          </button>
          <button className="btn" onClick={openAdd}><Icon name="plus" />Add contract</button>
        </div>
      </div>

      <div className="stats">
        <div className="stat" style={{ '--i': 0 }}>
          <div className="stat-ico"><Icon name="users" size={20} /></div>
          <div>
            <div className="stat-label">Active contracts</div>
            <div className="stat-num"><CountUp value={active.length} /></div>
            <div className="stat-hint">{rows.length - active.length} completed</div>
          </div>
        </div>
        <div className="stat" style={{ '--i': 1 }}>
          <div className="stat-ico"><Icon name="wallet" size={20} /></div>
          <div>
            <div className="stat-label">Collected</div>
            <div className="stat-num"><small>PKR</small><CountUp value={sum('paid_amount')} /></div>
            <div className="stat-hint">All time</div>
          </div>
        </div>
        <div className="stat" style={{ '--i': 2 }}>
          <div className="stat-ico"><Icon name="clock" size={20} /></div>
          <div>
            <div className="stat-label">Due by month-end</div>
            <div className="stat-num"><small>PKR</small><CountUp value={sum('due_amount')} /></div>
            <div className="stat-hint">Includes earlier unpaid months</div>
          </div>
        </div>
        <div className="stat" style={{ '--i': 3 }}>
          <div className="stat-ico"><Icon name="alert" size={20} /></div>
          <div>
            <div className="stat-label">Overdue contracts</div>
            <div className="stat-num"><CountUp value={overdueRows.length} /></div>
            <div className="stat-hint">{dryRun ? 'Test mode: messages are not sent' : 'WhatsApp is live'}</div>
          </div>
        </div>
      </div>

      <section className="panel">
        <div className="toolbar">
          <div className="chips">
            {[['', 'All'], ['INSTALLMENT', 'Installments'], ['RENT', 'Rent'], ['OVERDUE', 'Overdue']].map(([k, l]) => (
              <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                {l}<b>{counts[k]}</b>
              </button>
            ))}
          </div>
          <div className="search">
            <Icon name="search" />
            <input
              placeholder="Search client or property"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>

        <div className="tw">
          <table>
            <thead>
              <tr>
                <th>Client</th><th>Property</th><th>Monthly</th>
                <th>Progress</th><th>Next due</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {loading && [0, 1, 2].map((i) => (
                <tr key={i}>
                  {[0, 1, 2, 3, 4, 5, 6].map((j) => <td key={j}><div className="skel" /></td>)}
                </tr>
              ))}

              {!loading && shown.map((c, i) => {
                const od = c.overdue_count > 0;
                const inst = c.kind === 'INSTALLMENT';
                const pct = inst && c.months ? Math.min(100, (c.paid_count / c.months) * 100) : 0;
                return (
                  <tr key={c.id} className="rowin" style={{ '--i': Math.min(i, 14) }}>
                    <td>
                      <div className="person">
                        <div className="avatar" style={{ background: avatarBg(c.id) }}>
                          {initials(c.client_name)}
                        </div>
                        <div>
                          <strong>{c.client_name}</strong>
                          <span className="sub">{inst ? 'Buyer' : 'Tenant'} · {c.phone || 'No phone'}</span>
                          {c.start_date && <span className="sub">Started {fmtDate(c.start_date)}</span>}
                        </div>
                      </div>
                    </td>
                    <td>
                      <strong>{c.property}</strong>
                      <span className="sub">{c.property_type || (inst ? 'Residential property' : 'Rental property')} · {inst ? 'Installment plan' : 'Monthly tenancy'}</span>
                      {c.contract_ref && <span className="sub">Ref: {c.contract_ref}</span>}
                      {c.property_address && <span className="sub">{c.property_address}</span>}
                    </td>
                    <td><span className="fee">PKR {money(c.monthly_amount)}</span></td>
                    <td style={{ minWidth: 130 }}>
                      <span className="sub" style={{ color: 'var(--ink)' }}>
                        {c.paid_count}{inst ? ` of ${c.months}` : ''} paid
                      </span>
                      {inst && (
                        <div style={{ height: 6, borderRadius: 99, background: 'var(--line2)', marginTop: 6, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${pct}%`, background: 'var(--ok)', transition: 'width .6s ease' }} />
                        </div>
                      )}
                    </td>
                    <td className={od ? 'overdue' : ''}>
                      {fmtDate(c.next_due)}
                      {od && <><br /><span className="tag">{c.overdue_count} overdue</span></>}
                    </td>
                    <td>
                      {c.status === 'COMPLETED' ? (
                        <span className="pill paid">Completed</span>
                      ) : od ? (
                        <span className="pill failed">Overdue</span>
                      ) : (
                        <span className="pill" style={{ background: 'var(--prisoft)', color: 'var(--pri)' }}>Active</span>
                      )}
                    </td>
                    <td>
                      <div className="actions">
                        <button className="btn ghost sm" onClick={() => openPays(c)}>Payments</button>
                        <button className="btn icon" title="Edit" onClick={() => openEdit(c)}>
                          <Icon name="edit" />
                        </button>
                        <button
                          className="btn icon del"
                          title="Delete"
                          onClick={() => setConfirmState({
                            title: `Delete ${c.client_name}?`,
                            text: 'This contract and its payment history will be permanently removed.',
                            confirmLabel: 'Delete',
                            danger: true,
                            onOk: () => act(() => api(`/realestate/contracts/${c.id}`, 'DELETE'), 'Contract deleted.'),
                          })}
                        >
                          <Icon name="trash" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!loading && !shown.length && (
            <div className="empty">
              <div className="ico"><Icon name="wallet" size={26} /></div>
              <strong>{rows.length ? 'No matching contracts' : 'No contracts yet'}</strong>
              <div className="muted">
                {rows.length ? 'Try a different search or filter.' : 'Add a house on installments or a rental to begin.'}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="toolbar"><h2>Recent messages</h2></div>
        <div className="tw">
          <table>
            <thead>
              <tr><th>When</th><th>Client</th><th>Number</th><th>Type</th><th>Result</th></tr>
            </thead>
            <tbody>
              {msgs.slice(0, 8).map((m) => (
                <tr key={m.id}>
                  <td className="muted">{fmtWhen(m.at)}</td>
                  <td><strong>{m.name || '—'}</strong></td>
                  <td>{m.to_number}</td>
                  <td style={{ textTransform: 'capitalize' }}>
                    {String(m.kind).toLowerCase().replace('_', ' ')}
                  </td>
                  <td>
                    <span className={`pill ${m.ok ? 'paid' : 'failed'}`}>{m.ok ? 'Sent' : 'Failed'}</span>
                    {!m.ok && m.detail && <span className="sub">{m.detail}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!msgs.length && (
            <div className="empty">
              <strong>No messages yet</strong>
              <div className="muted">Receipts and month-end alerts will appear here.</div>
            </div>
          )}
        </div>
      </section>

      {/* ---------- add / edit drawer ---------- */}
      {drawer && (
        <>
          <div className="overlay" onClick={() => setDrawer(null)} />
          <aside className="drawer">
            <form onSubmit={save}>
              <div className="drawer-head">
                <div>
                  <h2>{drawer.id ? 'Edit contract' : 'Add contract'}</h2>
                  <span className="muted">
                    {drawer.id ? 'Type, months and start month are fixed once created' : 'The payment schedule is created automatically'}
                  </span>
                </div>
                <button type="button" className="btn icon" onClick={() => setDrawer(null)}>
                  <Icon name="x" />
                </button>
              </div>

              <div className="drawer-body">
                <div className="group">
                  <h3>Contract</h3>
                  <div className="stack">
                    <label className="field"><span>Type</span>
                      <select value={form.kind} onChange={set('kind')} disabled={!!drawer.id}>
                        <option value="INSTALLMENT">House on installments</option>
                        <option value="RENT">Monthly rent</option>
                      </select>
                    </label>
                    <label className="field"><span>Property <em>*</em></span>
                      <input
                        className={formErr && !form.property.trim() ? 'invalid' : ''}
                        value={form.property}
                        onChange={set('property')}
                        placeholder="House 12, Block C"
                      />
                    </label>
                    <div className="two">
                      <label className="field"><span>Property type</span>
                        <select value={form.property_type} onChange={set('property_type')}>
                          <option>Residential</option><option>Commercial</option><option>Plot</option><option>Apartment</option><option>Office</option><option>Shop</option><option>Other</option>
                        </select>
                      </label>
                      <label className="field"><span>Contract reference</span><input value={form.contract_ref} onChange={set('contract_ref')} placeholder="AGR-2026-001" /></label>
                    </div>
                    <label className="field"><span>Property address</span><input value={form.property_address} onChange={set('property_address')} placeholder="Street, block, area, city" /></label>
                  </div>
                </div>

                <div className="group">
                  <h3>{form.kind === 'RENT' ? 'Tenant' : 'Buyer'}</h3>
                  <div className="stack">
                    <label className="field"><span>Full name <em>*</em></span>
                      <input
                        autoFocus
                        className={formErr && !form.client_name.trim() ? 'invalid' : ''}
                        value={form.client_name}
                        onChange={set('client_name')}
                      />
                    </label>
                    <label className="field"><span>WhatsApp number</span>
                      <input value={form.phone} onChange={set('phone')} placeholder="923001234567" />
                    </label>
                    <div className="two">
                      <label className="field"><span>Agreement start</span><input type="date" value={form.start_date} onChange={set('start_date')} /></label>
                      <label className="field"><span>Agreement end</span><input type="date" value={form.end_date} onChange={set('end_date')} /></label>
                    </div>
                  </div>
                </div>

                <div className="group">
                  <h3>Payments</h3>
                  <div className="stack">
                    <label className="field"><span>Monthly amount (PKR)</span>
                      <input type="number" min="0" value={form.monthly_amount} onChange={set('monthly_amount')} />
                    </label>
                    <div className="two">
                      {form.kind === 'INSTALLMENT' && (
                        <label className="field"><span>Number of months</span>
                          <input
                            type="number"
                            min="1"
                            value={form.months}
                            onChange={set('months')}
                            disabled={!!drawer.id}
                          />
                        </label>
                      )}
                      <label className="field"><span>First month</span>
                        <input
                          type="month"
                          value={form.start_month}
                          onChange={set('start_month')}
                          disabled={!!drawer.id}
                        />
                      </label>
                    </div>
                    <label className="field"><span>Security deposit (PKR)</span><input type="number" min="0" value={form.security_deposit} onChange={set('security_deposit')} placeholder="0" /></label>
                    <label className="field"><span>Agreement / internal notes</span><textarea rows="3" value={form.notes} onChange={set('notes')} placeholder="Terms, maintenance, special conditions…" /></label>
                  </div>
                </div>
              </div>

              <div className="drawer-foot">
                <button type="button" className="btn ghost" onClick={() => setDrawer(null)}>Cancel</button>
                <button type="submit" className="btn" disabled={saving}>
                  {saving && <span className="spin" />}
                  {drawer.id ? 'Save changes' : 'Add contract'}
                </button>
              </div>
            </form>
          </aside>
        </>
      )}

      {/* ---------- payments drawer ---------- */}
      {viewRow && (
        <>
          <div className="overlay" onClick={() => setView(null)} />
          <aside className="drawer">
            <form onSubmit={(e) => e.preventDefault()}>
              <div className="drawer-head">
                <div>
                  <h2>{viewRow.client_name}</h2>
                  <span className="muted">{viewRow.property}</span>
                </div>
                <button type="button" className="btn icon" onClick={() => setView(null)}>
                  <Icon name="x" />
                </button>
              </div>
              <div className="drawer-body">
                {!pays.length && <div className="muted">Loading payments…</div>}
                {pays.map((p) => {
                  const late = p.status === 'PENDING' && p.due_date < today;
                  return (
                    <div
                      key={p.id}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line)',
                      }}
                    >
                      <div>
                        <strong className={late ? 'overdue' : ''}>{fmtDate(p.due_date)}</strong>
                        <span className="sub">PKR {money(p.amount)}</span>
                      </div>
                      <div className="actions">
                        <span className={`pill ${p.status === 'PAID' ? 'paid' : late ? 'failed' : 'pending'}`}>
                          {p.status === 'PAID' ? 'Paid' : late ? 'Overdue' : 'Pending'}
                        </span>
                        {p.status === 'PENDING' ? (
                          <button type="button" className="btn ok sm" onClick={() => setPaid(p, true)}>
                            Mark paid
                          </button>
                        ) : (
                          <button type="button" className="btn ghost sm" onClick={() => setPaid(p, false)}>
                            Undo
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </form>
          </aside>
        </>
      )}

      {/* ---------- confirm modal ---------- */}
      {confirmState && (
        <>
          <div className="overlay" onClick={() => setConfirmState(null)} />
          <div className="modal" role="dialog">
            <div className={`ico ${confirmState.danger ? 'bad' : ''}`}>
              <Icon name={confirmState.danger ? 'alert' : 'send'} size={22} />
            </div>
            <h2>{confirmState.title}</h2>
            <p>{confirmState.text}</p>
            <div className="row">
              <button className="btn ghost" onClick={() => setConfirmState(null)}>Cancel</button>
              <button
                className={`btn ${confirmState.danger ? 'danger' : ''}`}
                onClick={async () => {
                  const fn = confirmState.onOk;
                  setConfirmState(null);
                  await fn();
                }}
              >
                {confirmState.confirmLabel || 'Confirm'}
              </button>
            </div>
          </div>
        </>
      )}

      {toast && (
        <div key={toast.id} className={`toast ${toast.type === 'err' ? 'err' : ''}`}>
          <span className="ti"><Icon name={toast.type === 'err' ? 'alert' : 'check'} /></span>
          <span>{toast.text}</span>
        </div>
      )}
    </>
  );
}