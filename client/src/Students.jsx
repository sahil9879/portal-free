import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { Icon } from './ui.jsx';

const empty = {
  name: '', student_code: '', class_name: '', section: '', roll_number: '',
  admission_date: '', address: '', notes: '', phone: '', parent_name: '',
  guardian_relation: '', parent_phone: '', amount: '', term: '', due_date: '', opt_in: true
};
const FIELDS = Object.keys(empty);

const initials = (n = '') =>
  n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
const money = (n) => Number(n || 0).toLocaleString('en-PK');
const fmtDate = (d) => {
  if (!d) return '—';
  const x = new Date(d + 'T00:00:00');
  return isNaN(x) ? d : x.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const avatarBg = (id) => {
  const h = (Number(id) * 47) % 360;
  return `linear-gradient(135deg, hsl(${h} 70% 55%), hsl(${(h + 45) % 360} 70% 42%))`;
};

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

function Ring({ pct }) {
  const r = 24;
  const c = 2 * Math.PI * r;
  return (
    <svg className="ring" width="56" height="56" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r={r} className="ring-bg" />
      <circle cx="32" cy="32" r={r} className="ring-fg"
        style={{ strokeDasharray: c, strokeDashoffset: c * (1 - Math.min(100, pct) / 100) }} />
    </svg>
  );
}

export default function Students() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('');
  const [drawer, setDrawer] = useState(null); // { id: number|null }
  const [form, setForm] = useState(empty);
  const [formErr, setFormErr] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [toast, setToast] = useState(null);
  const timer = useRef();
  const fileRef = useRef();

  const notify = (text, type = 'ok') => {
    clearTimeout(timer.current);
    setToast({ text, type, id: Date.now() });
    timer.current = setTimeout(() => setToast(null), 3600);
  };

  const load = () =>
    api('/students')
      .then(setRows)
      .catch((e) => notify(e.message, 'err'))
      .finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  useEffect(() => {
    const h = (e) => {
      if (e.key !== 'Escape') return;
      if (confirmState) setConfirmState(null);
      else if (drawer) setDrawer(null);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [confirmState, drawer]);

  const act = async (fn, ok) => {
    try { await fn(); if (ok) notify(ok); load(); } catch (e) { notify(e.message, 'err'); }
  };
  const ask = (opts) => setConfirmState(opts);

  /* ----- add / edit ----- */
  const openAdd = () => { setForm(empty); setFormErr(false); setDrawer({ id: null }); };
  const openEdit = (s) => {
    setForm(Object.fromEntries(FIELDS.map((f) => [f, s[f] ?? ''])));
    setFormErr(false);
    setDrawer({ id: s.id });
  };
  const set = (k) => (e) => { setForm({ ...form, [k]: e.target.value }); if (k === 'name') setFormErr(false); };

  async function save(e) {
    e.preventDefault();
    if (!form.name.trim()) { setFormErr(true); notify('Student name is required.', 'err'); return; }
    setSaving(true);
    const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]));
    try {
      if (drawer.id) await api(`/students/${drawer.id}`, 'PUT', body);
      else await api('/students', 'POST', body);
      notify(drawer.id ? 'Student updated.' : 'Student added successfully.');
      setDrawer(null);
      load();
    } catch (err) { notify(err.message, 'err'); }
    setSaving(false);
  }

  /* ----- csv + reminders ----- */
  async function importCsv(file) {
    const text = await file.text();
    const [head, ...lines] = text.trim().split(/\r?\n/);
    const cols = head.split(',').map((c) => c.trim().toLowerCase());
    const data = lines.filter(Boolean).map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v.trim()])));
    act(() => api('/students/import', 'POST', data), `Imported ${data.length} students.`);
  }

  const remind = () => ask({
    title: 'Send reminders now?',
    text: 'A WhatsApp reminder will be sent to every student with a pending fee.',
    confirmLabel: 'Send reminders',
    onOk: async () => {
      setBusy(true);
      try {
        const r = await api('/remind-now', 'POST', { force: true });
        notify(`Reminders sent for ${r.sent} students.`);
        load();
      } catch (e) { notify(e.message, 'err'); }
      setBusy(false);
    },
  });

  /* ----- derived data ----- */
  const today = new Date().toISOString().slice(0, 10);
  const isOverdue = (s) => s.status === 'PENDING' && s.due_date && s.due_date < today;
  const paidRows = rows.filter((s) => s.status === 'PAID');
  const pendingRows = rows.filter((s) => s.status === 'PENDING');
  const overdueRows = rows.filter(isOverdue);
  const sum = (a) => a.reduce((t, s) => t + (Number(s.amount) || 0), 0);
  const collected = sum(paidRows);
  const outstanding = sum(pendingRows);
  const pct = collected + outstanding > 0
    ? (collected / (collected + outstanding)) * 100
    : rows.length ? (paidRows.length / rows.length) * 100 : 0;

  const counts = { '': rows.length, PENDING: pendingRows.length, PAID: paidRows.length, OVERDUE: overdueRows.length };
  const shown = rows.filter((s) =>
    (!filter || (filter === 'OVERDUE' ? isOverdue(s) : s.status === filter)) &&
    (!q || `${s.name}${s.student_code}${s.class_name}${s.section}${s.roll_number}${s.phone}${s.parent_name}${s.guardian_relation}${s.parent_phone}`.toLowerCase().includes(q.toLowerCase())));

  const dateStr = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Students</h1>
          <p className="muted">{dateStr}</p>
        </div>
        <div className="head-actions">
          <button className="btn ghost" onClick={() => fileRef.current.click()}
            title="CSV columns: name, student_code, class_name, section, roll_number, admission_date, address, phone, parent_name, guardian_relation, parent_phone, amount, term, due_date">
            <Icon name="upload" />Import CSV
          </button>
          <input ref={fileRef} type="file" accept=".csv" hidden
            onChange={(e) => { const f = e.target.files[0]; if (f) importCsv(f); e.target.value = ''; }} />
          <button className="btn ghost" disabled={busy} onClick={remind}>
            {busy ? <span className="spin" /> : <Icon name="send" />}
            {busy ? 'Sending…' : 'Send reminders'}
          </button>
          <button className="btn" onClick={openAdd}><Icon name="plus" />Add student</button>
        </div>
      </div>

      <div className="stats">
        <div className="stat" style={{ '--i': 0, '--t': '#6366f1' }}>
          <div className="stat-ico"><Icon name="users" size={20} /></div>
          <div>
            <div className="stat-label">Total students</div>
            <div className="stat-num"><CountUp value={rows.length} /></div>
            <div className="stat-hint">{paidRows.length} paid · {pendingRows.length} pending</div>
          </div>
        </div>
        <div className="stat" style={{ '--i': 1, '--t': 'var(--ok)' }}>
          <div className="stat-ico"><Icon name="wallet" size={20} /></div>
          <div>
            <div className="stat-label">Collected</div>
            <div className="stat-num"><small>PKR</small><CountUp value={collected} /></div>
            <div className="stat-hint">From {paidRows.length} students</div>
          </div>
        </div>
        <div className="stat" style={{ '--i': 2, '--t': 'var(--warn)' }}>
          <div className="stat-ico"><Icon name="clock" size={20} /></div>
          <div>
            <div className="stat-label">Outstanding</div>
            <div className="stat-num"><small>PKR</small><CountUp value={outstanding} /></div>
            <div className="stat-hint">{overdueRows.length} overdue</div>
          </div>
        </div>
        <div className="stat" style={{ '--i': 3 }}>
          <Ring pct={pct} />
          <div>
            <div className="stat-label">Collection rate</div>
            <div className="stat-num"><CountUp value={pct} />%</div>
            <div className="stat-hint">of total fees</div>
          </div>
        </div>
      </div>

      <section className="panel">
        <div className="toolbar">
          <div className="chips">
            {[['', 'All'], ['PENDING', 'Pending'], ['PAID', 'Paid'], ['OVERDUE', 'Overdue']].map(([k, l]) => (
              <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                {l}<b>{counts[k]}</b>
              </button>
            ))}
          </div>
          <div className="search">
            <Icon name="search" />
            <input placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        <div className="tw">
          <table>
            <thead>
              <tr><th>Student</th><th>Parent / Guardian</th><th>Fee</th><th>Due date</th><th>Status</th><th /></tr>
            </thead>
            <tbody>
              {loading && [0, 1, 2, 3].map((i) => (
                <tr key={i}>{[0, 1, 2, 3, 4, 5].map((j) => <td key={j}><div className="skel" style={{ width: j === 5 ? 70 : '75%' }} /></td>)}</tr>
              ))}

              {!loading && shown.map((s, i) => {
                const od = isOverdue(s);
                const days = od ? Math.max(1, Math.floor((Date.now() - new Date(s.due_date + 'T00:00:00')) / 864e5)) : 0;
                return (
                  <tr key={s.id} className="rowin" style={{ '--i': Math.min(i, 14) }}>
                    <td>
                      <div className="person">
                        <div className="avatar" style={{ background: avatarBg(s.id) }}>{initials(s.name)}</div>
                        <div><strong>{s.name}</strong><span className="sub">{s.student_code || s.roll_number ? `${s.student_code || 'Student'}${s.roll_number ? ` · Roll ${s.roll_number}` : ''}` : (s.phone || 'No number')}</span><span className="sub">{[s.class_name, s.section ? `Section ${s.section}` : ''].filter(Boolean).join(' · ')}</span></div>
                      </div>
                    </td>
                    <td>{s.parent_name || '—'}<span className="sub">{[s.guardian_relation, s.parent_phone].filter(Boolean).join(' · ')}</span></td>
                    <td>
                      <span className="fee">{s.amount != null ? `PKR ${money(s.amount)}` : '—'}</span>
                      <span className="sub">{s.term}</span>
                    </td>
                    <td className={od ? 'overdue' : ''}>
                      {fmtDate(s.due_date)}
                      {od && <><br /><span className="tag">{days}d overdue</span></>}
                    </td>
                    <td><span className={`pill ${s.status.toLowerCase()}`}><i className="dot" />{s.status.toLowerCase()}</span></td>
                    <td>
                      <div className="actions">
                        {s.status === 'PENDING'
                          ? <button className="btn ok sm" onClick={() => act(() => api(`/students/${s.id}/paid`, 'POST'), 'Marked paid. Confirmation message queued.')}><Icon name="check" size={14} />Mark paid</button>
                          : <button className="btn ghost sm" onClick={() => act(() => api(`/students/${s.id}/pending`, 'POST'), 'Marked as pending.')}><Icon name="undo" size={14} />Undo</button>}
                        <button className="btn icon" title="Edit" onClick={() => openEdit(s)}><Icon name="edit" /></button>
                        <button className="btn icon del" title="Delete" onClick={() => ask({
                          title: `Delete ${s.name}?`,
                          text: 'This student and their fee record will be permanently removed.',
                          confirmLabel: 'Delete', danger: true,
                          onOk: () => act(() => api(`/students/${s.id}`, 'DELETE'), 'Student deleted.'),
                        })}><Icon name="trash" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!loading && !shown.length && (
            <div className="empty">
              <div className="ico"><Icon name="users" size={26} /></div>
              <strong>{rows.length ? 'No matching students' : 'No students yet'}</strong>
              <div className="muted">
                {rows.length ? 'Try a different search or filter.' : 'Add a student or import a CSV (name, phone, parent_name, parent_phone, amount, term, due_date).'}
              </div>
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
                  <h2>{drawer.id ? 'Edit student' : 'Add student'}</h2>
                  <span className="muted">{drawer.id ? 'Update the details below' : 'Enter the student and fee details'}</span>
                </div>
                <button type="button" className="btn icon" onClick={() => setDrawer(null)} title="Close"><Icon name="x" size={18} /></button>
              </div>

              <div className="drawer-body">
                <div className="group">
                  <h3>Student</h3>
                  <div className="stack">
                    <label className="field"><span>Full name <em>*</em></span>
                      <input autoFocus className={formErr ? 'invalid' : ''} value={form.name} onChange={set('name')} placeholder="e.g. Ali Raza" /></label>
                    <div className="two">
                      <label className="field"><span>Student ID / admission no.</span><input value={form.student_code} onChange={set('student_code')} placeholder="ST-2026-001" /></label>
                      <label className="field"><span>Roll number</span><input value={form.roll_number} onChange={set('roll_number')} placeholder="e.g. 24" /></label>
                    </div>
                    <div className="two">
                      <label className="field"><span>Class / programme</span><input value={form.class_name} onChange={set('class_name')} placeholder="Class 10 / BS" /></label>
                      <label className="field"><span>Section</span><input value={form.section} onChange={set('section')} placeholder="A" /></label>
                    </div>
                    <label className="field"><span>Student WhatsApp number</span>
                      <input value={form.phone} onChange={set('phone')} placeholder="03xx xxxxxxx" /></label>
                    <label className="field"><span>Admission date</span><input type="date" value={form.admission_date} onChange={set('admission_date')} /></label>
                    <label className="field"><span>Home address</span><input value={form.address} onChange={set('address')} placeholder="Street, area, city" /></label>
                  </div>
                </div>

                <div className="group">
                  <h3>Parent / Guardian</h3>
                  <div className="stack">
                    <label className="field"><span>Parent / guardian name</span>
                      <input value={form.parent_name} onChange={set('parent_name')} placeholder="Guardian name" /></label>
                    <label className="field"><span>Relationship</span>
                      <select value={form.guardian_relation} onChange={set('guardian_relation')}>
                        <option value="">Select relationship</option><option>Father</option><option>Mother</option><option>Guardian</option><option>Brother / Sister</option><option>Other</option>
                      </select></label>
                    <label className="field"><span>WhatsApp number</span>
                      <input value={form.parent_phone} onChange={set('parent_phone')} placeholder="03xx xxxxxxx" /></label>
                  </div>
                </div>

                <div className="group">
                  <h3>Fee details</h3>
                  <div className="stack">
                    <div className="two">
                      <label className="field"><span>Amount (PKR)</span>
                        <input type="number" min="0" value={form.amount} onChange={set('amount')} placeholder="0" /></label>
                      <label className="field"><span>Term</span>
                        <input value={form.term} onChange={set('term')} placeholder="Fall 2026" /></label>
                    </div>
                    <label className="field"><span>Due date</span>
                      <input type="date" value={form.due_date} onChange={set('due_date')} /></label>
                    <label className="field"><span>Internal notes</span><textarea rows="3" value={form.notes} onChange={set('notes')} placeholder="Scholarship, special arrangements, follow-up notes…" /></label>
                    <label className="consent-control"><input type="checkbox" checked={!!form.opt_in} onChange={(e) => setForm({ ...form, opt_in: e.target.checked })} /><span>Parent / student has agreed to receive WhatsApp fee updates</span></label>
                  </div>
                </div>
              </div>

              <div className="drawer-foot">
                <button type="button" className="btn ghost" onClick={() => setDrawer(null)}>Cancel</button>
                <button type="submit" className="btn" disabled={saving}>
                  {saving && <span className="spin" />}
                  {drawer.id ? 'Save changes' : 'Add student'}
                </button>
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
              <button className={`btn ${confirmState.danger ? 'danger' : ''}`} onClick={async () => {
                const fn = confirmState.onOk;
                setConfirmState(null);
                await fn();
              }}>{confirmState.confirmLabel || 'Confirm'}</button>
            </div>
          </div>
        </>
      )}

      {toast && (
        <div key={toast.id} className={`toast ${toast.type === 'err' ? 'err' : ''}`}>
          <span className="ti"><Icon name={toast.type === 'err' ? 'alert' : 'check'} size={18} /></span>
          <span>{toast.text}</span>
        </div>
      )}
    </>
  );
}