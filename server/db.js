import 'dotenv/config';
import Database from 'better-sqlite3';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const configuredPath = process.env.DB_FILE || 'fees.db';
const dbPath = isAbsolute(configuredPath) ? configuredPath : resolve(here, configuredPath);

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  student_code TEXT,
  class_name TEXT,
  section TEXT,
  roll_number TEXT,
  admission_date TEXT,
  address TEXT,
  notes TEXT,
  phone TEXT,
  parent_name TEXT,
  guardian_relation TEXT,
  parent_phone TEXT,
  amount REAL,
  term TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  opt_in INTEGER NOT NULL DEFAULT 1,
  last_reminder TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER,
  contract_id INTEGER,
  to_number TEXT,
  kind TEXT,
  ok INTEGER,
  detail TEXT,
  at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contracts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('INSTALLMENT', 'RENT')),
  property TEXT NOT NULL,
  property_type TEXT,
  property_address TEXT,
  contract_ref TEXT,
  start_date TEXT,
  end_date TEXT,
  security_deposit REAL,
  notes TEXT,
  client_name TEXT NOT NULL,
  phone TEXT,
  monthly_amount REAL NOT NULL CHECK (monthly_amount > 0),
  months INTEGER,
  start_month TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS contract_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contract_id INTEGER NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  due_month TEXT NOT NULL,
  due_date TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID')),
  paid_at TEXT,
  UNIQUE(contract_id, due_month)
);
CREATE INDEX IF NOT EXISTS idx_contract_payments_due ON contract_payments(status, due_date);
`);

// Safe migration for databases created by earlier versions of this project.
const logColumns = db.prepare('PRAGMA table_info(log)').all().map((column) => column.name);
if (!logColumns.includes('contract_id')) {
  db.exec('ALTER TABLE log ADD COLUMN contract_id INTEGER');
}
db.exec('CREATE INDEX IF NOT EXISTS idx_log_contract ON log(contract_id)');

// Add role-specific profile fields without disturbing existing records.
const addMissingColumns = (table, definitions) => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name);
  for (const [name, type] of definitions) {
    if (!columns.includes(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
};
addMissingColumns('students', [
  ['student_code', 'TEXT'], ['class_name', 'TEXT'], ['section', 'TEXT'],
  ['roll_number', 'TEXT'], ['admission_date', 'TEXT'], ['address', 'TEXT'], ['notes', 'TEXT'], ['guardian_relation', 'TEXT']
]);
addMissingColumns('contracts', [
  ['property_type', 'TEXT'], ['property_address', 'TEXT'], ['contract_ref', 'TEXT'],
  ['start_date', 'TEXT'], ['end_date', 'TEXT'], ['security_deposit', 'REAL'], ['notes', 'TEXT']
]);
