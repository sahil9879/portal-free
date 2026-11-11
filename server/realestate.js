import express from 'express';
import { db } from './db.js';
import { normalizePhone } from './whatsapp.js';

const routerFactory = ({ send, dryRun }) => {
  const router = express.Router();
  db.exec(`CREATE TABLE IF NOT EXISTS realestate_alert_runs (payment_id INTEGER NOT NULL, run_date TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, UNIQUE(payment_id, run_date))`);
  const today = () => new Date().toISOString().slice(0, 10);
  const monthOf = (date) => String(date).slice(0, 7);
  const monthDate = (month) => `${month}-01`;
  const addMonths = (month, count) => {
    const [year, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(year, m - 1 + count, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const lastDay = (month) => {
    const [year, m] = month.split('-').map(Number);
    return new Date(Date.UTC(year, m, 0)).getUTCDate();
  };
  const paymentDueDate = (month) => `${month}-${String(lastDay(month)).padStart(2, '0')}`;

  function ensureSchedule(contract) {
    const endMonth = contract.kind === 'INSTALLMENT'
      ? addMonths(contract.start_month, Math.max(0, Number(contract.months) - 1))
      : addMonths(monthOf(today()), 12);
    const insert = db.prepare(`INSERT OR IGNORE INTO contract_payments
      (contract_id, due_month, due_date, amount) VALUES (?, ?, ?, ?)`);
    const start = contract.start_month;
    for (let m = start; m <= endMonth; m = addMonths(m, 1)) {
      insert.run(contract.id, m, paymentDueDate(m), contract.monthly_amount);
    }
  }

  function refreshRentSchedules() {
    const rents = db.prepare("SELECT * FROM contracts WHERE kind='RENT' AND status='ACTIVE'").all();
    rents.forEach(ensureSchedule);
  }

  function contractSummary(contract) {
    const payments = db.prepare('SELECT * FROM contract_payments WHERE contract_id=? ORDER BY due_month').all(contract.id);
    const paid = payments.filter((p) => p.status === 'PAID');
    const pending = payments.filter((p) => p.status === 'PENDING');
    const todayMonth = monthOf(today());
    const due = pending.filter((p) => p.due_month <= todayMonth);
    const overdue = pending.filter((p) => p.due_date < today());
    const next = pending[0];
    const completed = contract.kind === 'INSTALLMENT' && paid.length >= Number(contract.months);
    if (completed && contract.status !== 'COMPLETED') {
      db.prepare("UPDATE contracts SET status='COMPLETED' WHERE id=?").run(contract.id);
    } else if (!completed && contract.status !== 'ACTIVE') {
      db.prepare("UPDATE contracts SET status='ACTIVE' WHERE id=?").run(contract.id);
    }
    return {
      ...contract,
      status: completed ? 'COMPLETED' : 'ACTIVE',
      paid_count: paid.length,
      paid_amount: paid.reduce((sum, p) => sum + Number(p.amount), 0),
      due_amount: due.reduce((sum, p) => sum + Number(p.amount), 0),
      overdue_count: overdue.length,
      next_due: next?.due_date || null,
    };
  }

  router.get('/contracts', (req, res) => {
    refreshRentSchedules();
    const rows = db.prepare('SELECT * FROM contracts ORDER BY id DESC').all().map(contractSummary);
    res.json({ rows, dryRun });
  });

  router.post('/contracts', (req, res) => {
    const b = req.body || {};
    const kind = b.kind === 'RENT' ? 'RENT' : 'INSTALLMENT';
    const property = String(b.property || '').trim();
    const clientName = String(b.client_name || '').trim();
    const phone = String(b.phone || '').trim();
    const propertyType = String(b.property_type || '').trim();
    const propertyAddress = String(b.property_address || '').trim();
    const contractRef = String(b.contract_ref || '').trim();
    const startDate = String(b.start_date || '').trim();
    const endDate = String(b.end_date || '').trim();
    const deposit = b.security_deposit === '' || b.security_deposit == null ? null : Number(b.security_deposit);
    const notes = String(b.notes || '').trim();
    const amount = Number(b.monthly_amount);
    const months = kind === 'INSTALLMENT' ? Number(b.months) : null;
    const startMonth = String(b.start_month || '');
    if (!property || !clientName) return res.status(400).json({ error: 'Client name and property are required.' });
    if (!(amount > 0) || !Number.isFinite(amount)) return res.status(400).json({ error: 'Monthly amount must be greater than zero.' });
    if (kind === 'INSTALLMENT' && (!Number.isInteger(months) || months < 1 || months > 600)) {
      return res.status(400).json({ error: 'Number of months must be between 1 and 600.' });
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(startMonth)) return res.status(400).json({ error: 'A valid first month is required.' });
    const result = db.prepare(`INSERT INTO contracts
      (kind, property, property_type, property_address, contract_ref, start_date, end_date,
       security_deposit, notes, client_name, phone, monthly_amount, months, start_month)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(kind, property, propertyType || null, propertyAddress || null, contractRef || null,
        startDate || null, endDate || null, Number.isFinite(deposit) ? deposit : null,
        notes || null, clientName, phone || null, amount, months, startMonth);
    const contract = db.prepare('SELECT * FROM contracts WHERE id=?').get(Number(result.lastInsertRowid));
    ensureSchedule(contract);
    res.status(201).json({ id: Number(result.lastInsertRowid) });
  });

  router.put('/contracts/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = db.prepare('SELECT * FROM contracts WHERE id=?').get(id);
    if (!existing) return res.status(404).json({ error: 'Contract not found.' });
    const b = req.body || {};
    const property = String(b.property || '').trim();
    const clientName = String(b.client_name || '').trim();
    const phone = String(b.phone || '').trim();
    const propertyType = String(b.property_type || '').trim();
    const propertyAddress = String(b.property_address || '').trim();
    const contractRef = String(b.contract_ref || '').trim();
    const startDate = String(b.start_date || '').trim();
    const endDate = String(b.end_date || '').trim();
    const deposit = b.security_deposit === '' || b.security_deposit == null ? null : Number(b.security_deposit);
    const notes = String(b.notes || '').trim();
    const amount = Number(b.monthly_amount);
    if (!property || !clientName) return res.status(400).json({ error: 'Client name and property are required.' });
    if (!(amount > 0) || !Number.isFinite(amount)) return res.status(400).json({ error: 'Monthly amount must be greater than zero.' });
    db.prepare(`UPDATE contracts SET property=?, property_type=?, property_address=?, contract_ref=?,
      start_date=?, end_date=?, security_deposit=?, notes=?, client_name=?, phone=?, monthly_amount=? WHERE id=?`)
      .run(property, propertyType || null, propertyAddress || null, contractRef || null,
        startDate || null, endDate || null, Number.isFinite(deposit) ? deposit : null,
        notes || null, clientName, phone || null, amount, id);
    // Keep unpaid scheduled amounts in sync; preserve amounts on already-paid receipts.
    db.prepare("UPDATE contract_payments SET amount=? WHERE contract_id=? AND status='PENDING'").run(amount, id);
    res.json({ ok: true });
  });

  router.delete('/contracts/:id', (req, res) => {
    const id = Number(req.params.id);
    const result = db.prepare('DELETE FROM contracts WHERE id=?').run(id);
    if (!result.changes) return res.status(404).json({ error: 'Contract not found.' });
    res.json({ ok: true });
  });

  router.get('/contracts/:id/payments', (req, res) => {
    const contract = db.prepare('SELECT * FROM contracts WHERE id=?').get(Number(req.params.id));
    if (!contract) return res.status(404).json({ error: 'Contract not found.' });
    ensureSchedule(contract);
    res.json(db.prepare('SELECT * FROM contract_payments WHERE contract_id=? ORDER BY due_month').all(contract.id));
  });

  router.post('/payments/:id/:action', async (req, res) => {
    const paymentId = Number(req.params.id);
    const action = req.params.action;
    if (!['paid', 'unpaid'].includes(action)) return res.status(400).json({ error: 'Invalid payment action.' });
    const payment = db.prepare(`SELECT p.*, c.client_name, c.phone, c.property, c.id AS contract_id
      FROM contract_payments p JOIN contracts c ON c.id=p.contract_id WHERE p.id=?`).get(paymentId);
    if (!payment) return res.status(404).json({ error: 'Payment not found.' });
    if (action === 'unpaid') {
      db.prepare("UPDATE contract_payments SET status='PENDING', paid_at=NULL WHERE id=?").run(paymentId);
      res.json({ ok: true });
      return;
    }
    db.prepare("UPDATE contract_payments SET status='PAID', paid_at=CURRENT_TIMESTAMP WHERE id=?").run(paymentId);
    let delivery = { ok: false, detail: 'No WhatsApp number supplied.' };
    const number = normalizePhone(payment.phone);
    if (number && send) {
      try {
        delivery = await send(number, `Payment received: PKR ${Number(payment.amount).toLocaleString('en-PK')} for ${payment.property} (${payment.due_month}). Thank you.`);
      } catch (error) {
        delivery = { ok: false, detail: String(error.message || error) };
      }
    }
    db.prepare('INSERT INTO log (contract_id, to_number, kind, ok, detail) VALUES (?, ?, ?, ?, ?)')
      .run(payment.contract_id, number || payment.phone || '', 'REALESTATE_RECEIPT', delivery.ok ? 1 : 0, delivery.detail || '');
    res.json({ ok: true, message: delivery.detail });
  });

  router.get('/log', (req, res) => {
    res.json(db.prepare(`SELECT l.id, l.at, l.to_number, l.kind, l.ok, l.detail,
      COALESCE(c.client_name, '') AS name FROM log l
      LEFT JOIN contracts c ON c.id=l.contract_id
      WHERE l.contract_id IS NOT NULL ORDER BY l.id DESC LIMIT 200`).all());
  });

  async function runDueAlerts() {
    refreshRentSchedules();
    const currentMonth = monthOf(today());
    const due = db.prepare(`SELECT p.*, c.client_name, c.phone, c.property, c.id AS contract_id
      FROM contract_payments p JOIN contracts c ON c.id=p.contract_id
      WHERE p.status='PENDING' AND p.due_month<=? AND c.status='ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM realestate_alert_runs r WHERE r.payment_id=p.id AND r.run_date=?)
      ORDER BY p.due_date`).all(currentMonth, today());
    let sent = 0;
    for (const p of due) {
      // Record the attempt first so repeated cron/manual calls cannot spam a client.
      db.prepare('INSERT OR IGNORE INTO realestate_alert_runs (payment_id,run_date) VALUES (?,?)').run(p.id,today());
      const number = normalizePhone(p.phone);
      let result = { ok: false, detail: 'No WhatsApp number supplied.' };
      if (number && send) {
        try { result = await send(number, `Payment due: PKR ${Number(p.amount).toLocaleString('en-PK')} for ${p.property} (${p.due_month}). Please contact us if already paid.`); }
        catch (error) { result = { ok: false, detail: String(error.message || error) }; }
      }
      db.prepare('INSERT INTO log (contract_id, to_number, kind, ok, detail) VALUES (?, ?, ?, ?, ?)')
        .run(p.contract_id, number || p.phone || '', 'REALESTATE_ALERT', result.ok ? 1 : 0, result.detail || '');
      if (result.ok) sent += 1;
    }
    return { sent, checked: due.length };
  }
  router.post('/alerts/run', async (_req, res) => {
    try { res.json(await runDueAlerts()); }
    catch (error) { res.status(500).json({ error: error.message || 'Real-estate alert job failed.' }); }
  });
  router.runScheduledAlerts = runDueAlerts;

  return router;
};

export default routerFactory;
