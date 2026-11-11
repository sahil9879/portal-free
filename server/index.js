import 'dotenv/config';
import express from 'express';
import cron from 'node-cron';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';
import { notifyStudent, runReminders } from './notify.js';
import { normalizePhone, sendTemplate } from './whatsapp.js';
import realEstate from './realestate.js';
import hospital from './hospital.js';

const here = dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.json({ limit: '2mb' }));

const dryRun = process.env.DRY_RUN !== 'false';

app.get('/api/health', (_req, res) => res.json({ ok: true, modules: ['students', 'realestate', 'hospital'] }));

app.get('/api/config', (req, res) => {
  res.json({ institute: process.env.INSTITUTE_NAME || 'Fee Portal', dryRun });
});

/* ---------- students ---------- */
app.get('/api/students', (req, res) => {
  res.json(db.prepare('SELECT * FROM students ORDER BY id DESC').all());
});

app.post('/api/students', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ error: 'Student name is required.' });
  }
  const r = db
    .prepare(
      'INSERT INTO students (name, student_code, class_name, section, roll_number, admission_date, address, notes, phone, parent_name, guardian_relation, parent_phone, amount, term, due_date, opt_in) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
    )
    .run(
      String(b.name).trim(),
      b.student_code ?? null, b.class_name ?? null, b.section ?? null,
      b.roll_number ?? null, b.admission_date ?? null, b.address ?? null, b.notes ?? null,
      b.phone ?? null, b.parent_name ?? null, b.guardian_relation ?? null, b.parent_phone ?? null,
      b.amount ?? null, b.term ?? null, b.due_date ?? null, b.opt_in === false ? 0 : 1
    );
  res.json({ id: Number(r.lastInsertRowid) });
});

app.put('/api/students/:id', (req, res) => {
  const b = req.body || {};
  if (!b.name || !String(b.name).trim()) {
    return res.status(400).json({ error: 'Student name is required.' });
  }
  db.prepare(
    'UPDATE students SET name=?, student_code=?, class_name=?, section=?, roll_number=?, admission_date=?, address=?, notes=?, phone=?, parent_name=?, guardian_relation=?, parent_phone=?, amount=?, term=?, due_date=?, opt_in=? WHERE id=?'
  ).run(
    String(b.name).trim(),
    b.student_code ?? null, b.class_name ?? null, b.section ?? null,
    b.roll_number ?? null, b.admission_date ?? null, b.address ?? null, b.notes ?? null,
    b.phone ?? null, b.parent_name ?? null, b.guardian_relation ?? null, b.parent_phone ?? null,
    b.amount ?? null, b.term ?? null, b.due_date ?? null, b.opt_in === false ? 0 : 1,
    Number(req.params.id)
  );
  res.json({ ok: true });
});

app.delete('/api/students/:id', (req, res) => {
  db.prepare('DELETE FROM students WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

app.post('/api/students/:id/paid', async (req, res) => {
  const id = Number(req.params.id);
  db.prepare("UPDATE students SET status='PAID' WHERE id=?").run(id);
  const s = db.prepare('SELECT * FROM students WHERE id=?').get(id);
  if (s) await notifyStudent(s, 'CONFIRMATION');
  res.json({ ok: true });
});

app.post('/api/students/:id/pending', (req, res) => {
  db.prepare("UPDATE students SET status='PENDING', last_reminder=NULL WHERE id=?").run(
    Number(req.params.id)
  );
  res.json({ ok: true });
});

app.post('/api/students/import', (req, res) => {
  const ins = db.prepare(
    'INSERT INTO students (name, student_code, class_name, section, roll_number, admission_date, address, notes, phone, parent_name, guardian_relation, parent_phone, amount, term, due_date, opt_in) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  );
  const rows = Array.isArray(req.body) ? req.body : [];
  db.exec('BEGIN');
  try {
    rows.forEach((r) => r.name && ins.run(
      r.name, r.student_code ?? null, r.class_name ?? null, r.section ?? null,
      r.roll_number ?? null, r.admission_date ?? null, r.address ?? null, r.notes ?? null,
      r.phone ?? null, r.parent_name ?? null, r.guardian_relation ?? null, r.parent_phone ?? null,
      r.amount ?? null, r.term ?? null, r.due_date ?? null, r.opt_in === false ? 0 : 1
    ));
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    return res.status(400).json({ error: e.message });
  }
  res.json({ imported: rows.length });
});

/* ---------- reminders + log ---------- */
app.post('/api/remind-now', async (req, res) => {
  const sent = await runReminders({ force: !!(req.body && req.body.force) });
  res.json({ sent });
});

app.get('/api/log', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT l.id, l.at, l.to_number, l.kind, l.ok, l.detail,
                COALESCE(s.name, c.client_name, '') AS name
         FROM log l
         LEFT JOIN students s ON s.id = l.student_id
         LEFT JOIN contracts c ON c.id = l.contract_id
         ORDER BY l.id DESC LIMIT 200`
      )
      .all()
  );
});

/* ---------- real estate (rent + installments) ---------- */
// WhatsApp only allows approved templates. The whole message goes into
// template variable {{1}} of the template named WA_TEMPLATE_REALESTATE.
async function sendRealEstate(to, text) {
  const number = normalizePhone(to);
  if (!number) return { ok: false, detail: 'Invalid phone number' };
  const oneLine = text.replace(/\s*\n\s*/g, ' ');
  const template = process.env.WA_TEMPLATE_REALESTATE || 'realestate_notice';
  const r = await sendTemplate(number, template, [oneLine]);
  return { ok: r.ok, detail: r.detail };
}
const realEstateRouter = realEstate({ send: sendRealEstate, dryRun });
app.use('/api/realestate', realEstateRouter);
app.use('/api/hospital', hospital);

/* ---------- daily fee reminders ---------- */
cron.schedule(
  process.env.REMINDER_CRON || '0 9 * * *',
  () => runReminders().catch((e) => console.error('[cron]', e)),
  { timezone: process.env.TZ || 'Asia/Karachi' }
);

/* ---------- automatic daily workflows ---------- */
// Student fee reminders are already idempotent per student/day via last_reminder.
cron.schedule(process.env.REALESTATE_CRON || '15 9 * * *',
  () => realEstateRouter.runScheduledAlerts().catch((e) => console.error('[realestate-cron]', e)),
  { timezone: process.env.TZ || 'Asia/Karachi' }
);
cron.schedule(process.env.HOSPITAL_ALERT_CRON || '30 9 * * *',
  () => { try { hospital.runScheduledAlerts?.(); } catch (e) { console.error('[hospital-cron]', e); } },
  { timezone: process.env.TZ || 'Asia/Karachi' }
);

/* ---------- serve built client (production) ---------- */
const dist = join(here, '..', 'client', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(join(dist, 'index.html')));
}

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API running on http://localhost:${port}`));