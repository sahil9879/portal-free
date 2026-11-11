import { db } from './db.js';
import { normalizePhone, sendTemplate } from './whatsapp.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const logStmt = db.prepare(
  'INSERT INTO log (student_id, to_number, kind, ok, detail) VALUES (?,?,?,?,?)'
);

// kind: 'CONFIRMATION' | 'REMINDER'. Sends to the student and the parent.
export async function notifyStudent(s, kind) {
  if (!s.opt_in) return;
  const template =
    kind === 'CONFIRMATION' ? process.env.WA_TEMPLATE_CONFIRM : process.env.WA_TEMPLATE_REMINDER;
  const targets = [
    { who: s.name, number: normalizePhone(s.phone) },
    { who: s.parent_name ? `${s.parent_name} (parent of ${s.name})` : `Parent of ${s.name}`,
      number: normalizePhone(s.parent_phone) },
  ].filter((t) => t.number);

  for (const t of targets) {
    // Template variables: {{1}} recipient, {{2}} student, {{3}} amount, {{4}} term, {{5}} due date
    const params = [t.who, s.name, s.amount, s.term, s.due_date];
    try {
      const r = await sendTemplate(t.number, template, params);
      logStmt.run(s.id, t.number, kind, r.ok ? 1 : 0, r.detail);
    } catch (e) {
      logStmt.run(s.id, t.number, kind, 0, String(e.message || e));
    }
    await sleep(400); // gentle pacing
  }
}

// Reminder rule: 7 days before, 1 day before, on the due date, then every 3 days overdue.
export function shouldRemind(s, today = new Date()) {
  if (s.status !== 'PENDING' || !s.due_date) return false;
  const iso = today.toISOString().slice(0, 10);
  if (s.last_reminder === iso) return false;
  const days = Math.round((new Date(s.due_date) - new Date(iso)) / 86400000);
  return [7, 1, 0].includes(days) || (days < 0 && Math.abs(days) % 3 === 0);
}

export async function runReminders({ force = false } = {}) {
  const rows = db.prepare("SELECT * FROM students WHERE status='PENDING' AND opt_in=1").all();
  const iso = new Date().toISOString().slice(0, 10);
  let sent = 0;
  for (const s of rows) {
    if (force || shouldRemind(s)) {
      await notifyStudent(s, 'REMINDER');
      db.prepare('UPDATE students SET last_reminder=? WHERE id=?').run(iso, s.id);
      sent++;
    }
  }
  return sent;
}
