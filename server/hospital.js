import { Router } from 'express';
import { db } from './db.js';

// Pharmacy data is stored in the same SQLite database as the other portal modules.
db.exec(`
CREATE TABLE IF NOT EXISTS medicines (
 id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, generic_name TEXT, strength TEXT,
 batch_no TEXT, quantity INTEGER NOT NULL DEFAULT 0, reorder_level INTEGER NOT NULL DEFAULT 10,
 expiry_date TEXT, unit_price REAL DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS prescriptions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, patient_name TEXT NOT NULL, patient_phone TEXT,
 doctor_name TEXT NOT NULL, diagnosis TEXT, medicines_json TEXT NOT NULL, notes TEXT,
 order_status TEXT NOT NULL DEFAULT 'PENDING REVIEW', created_at TEXT DEFAULT CURRENT_TIMESTAMP,
 dispensed_at TEXT
);
CREATE TABLE IF NOT EXISTS hospital_alert_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL,
 message TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);
const router = Router();
const parseRx = row => ({ ...row, medicines: JSON.parse(row.medicines_json || '[]') });
const today = () => new Date().toISOString().slice(0,10);

function collectAlerts() {
  const now = today();
  const horizon = new Date(`${now}T00:00:00Z`); horizon.setUTCDate(horizon.getUTCDate()+30);
  const end = horizon.toISOString().slice(0,10);
  const rows = db.prepare('SELECT * FROM medicines').all();
  const insert = db.prepare('INSERT OR IGNORE INTO hospital_alert_events (event_key,kind,message) VALUES (?,?,?)');
  for (const m of rows) {
    if (Number(m.quantity) <= Number(m.reorder_level)) insert.run(`LOW:${m.id}:${now}`,'LOW_STOCK',`${m.name}: ${m.quantity} units left (reorder level ${m.reorder_level}).`);
    if (m.expiry_date && m.expiry_date <= end) insert.run(`EXP:${m.id}:${now}`,'EXPIRY',`${m.name} batch ${m.batch_no || 'N/A'} expires on ${m.expiry_date}.`);
  }
  return db.prepare('SELECT * FROM hospital_alert_events ORDER BY id DESC LIMIT 100').all();
}
router.get('/health', (_req,res)=>res.json({ok:true,module:'hospital'}));
router.get('/medicines', (_req,res)=>res.json(db.prepare('SELECT * FROM medicines ORDER BY name COLLATE NOCASE').all()));
router.post('/medicines', (req,res)=>{
 const b=req.body||{}; if(!String(b.name||'').trim()) return res.status(400).json({error:'Medicine name is required.'});
 const q=Number(b.quantity), level=Number(b.reorder_level);
 if(!Number.isInteger(q)||q<0||!Number.isInteger(level)||level<0) return res.status(400).json({error:'Quantity and reorder level must be whole numbers zero or greater.'});
 const r=db.prepare('INSERT INTO medicines (name,generic_name,strength,batch_no,quantity,reorder_level,expiry_date,unit_price) VALUES (?,?,?,?,?,?,?,?)').run(String(b.name).trim(),b.generic_name||null,b.strength||null,b.batch_no||null,q,level,b.expiry_date||null,Math.max(0,Number(b.unit_price)||0));
 collectAlerts(); res.status(201).json({id:Number(r.lastInsertRowid)});
});
router.put('/medicines/:id', (req,res)=>{
 const b=req.body||{}; if(!String(b.name||'').trim()) return res.status(400).json({error:'Medicine name is required.'});
 const q=Number(b.quantity), level=Number(b.reorder_level); if(!Number.isInteger(q)||q<0||!Number.isInteger(level)||level<0) return res.status(400).json({error:'Quantity and reorder level must be whole numbers zero or greater.'});
 const r=db.prepare('UPDATE medicines SET name=?,generic_name=?,strength=?,batch_no=?,quantity=?,reorder_level=?,expiry_date=?,unit_price=? WHERE id=?').run(String(b.name).trim(),b.generic_name||null,b.strength||null,b.batch_no||null,q,level,b.expiry_date||null,Math.max(0,Number(b.unit_price)||0),Number(req.params.id));
 if(!r.changes) return res.status(404).json({error:'Medicine not found.'}); collectAlerts(); res.json({ok:true});
});
router.delete('/medicines/:id',(req,res)=>{const r=db.prepare('DELETE FROM medicines WHERE id=?').run(Number(req.params.id)); if(!r.changes)return res.status(404).json({error:'Medicine not found.'});res.json({ok:true});});
router.get('/prescriptions',(_req,res)=>res.json(db.prepare('SELECT * FROM prescriptions ORDER BY id DESC').all().map(parseRx)));
router.post('/prescriptions',(req,res)=>{
 const b=req.body||{}; const meds=Array.isArray(b.medicines)?b.medicines.filter(m=>String(m.medicine_name||'').trim()):[];
 if(!String(b.patient_name||'').trim()||!String(b.doctor_name||'').trim()||!meds.length)return res.status(400).json({error:'Patient, doctor and at least one medicine are required.'});
 const r=db.prepare("INSERT INTO prescriptions (patient_name,patient_phone,doctor_name,diagnosis,medicines_json,notes,order_status) VALUES (?,?,?,?,?,?,'PENDING REVIEW')").run(String(b.patient_name).trim(),b.patient_phone||null,String(b.doctor_name).trim(),b.diagnosis||null,JSON.stringify(meds),b.notes||null);
 res.status(201).json({id:Number(r.lastInsertRowid),order_status:'PENDING REVIEW'});
});
router.patch('/orders/:id',(req,res)=>{
 const id=Number(req.params.id), status=String(req.body?.status||'');
 if(!['PENDING REVIEW','DISPENSED'].includes(status))return res.status(400).json({error:'Invalid pharmacy order status.'});
 const rx=db.prepare('SELECT * FROM prescriptions WHERE id=?').get(id); if(!rx)return res.status(404).json({error:'Prescription not found.'});
 if(status==='DISPENSED'){
  if(rx.order_status==='DISPENSED')return res.json({ok:true,already_dispensed:true});
  const meds=JSON.parse(rx.medicines_json||'[]');
  const resolve=db.prepare('SELECT * FROM medicines WHERE lower(name)=lower(?) OR lower(generic_name)=lower(?) ORDER BY id LIMIT 1');
  const update=db.prepare('UPDATE medicines SET quantity=quantity-? WHERE id=? AND quantity>=?');
  const tx=db.transaction(()=>{
   const items=[];
   for(const item of meds){const name=String(item.medicine_name||'').trim();const qty=Math.max(1,Math.floor(Number(item.quantity)||1));const med=resolve.get(name,name);if(!med)throw new Error(`Medicine "${name}" is not in inventory. Add it to stock first.`);if(med.expiry_date&&med.expiry_date<today())throw new Error(`${med.name} batch is expired and cannot be dispensed.`);if(med.quantity<qty)throw new Error(`Insufficient stock for ${med.name}. Available: ${med.quantity}, required: ${qty}.`);items.push({id:med.id,qty,name:med.name});}
   for(const item of items)update.run(item.qty,item.id,item.qty);
   db.prepare("UPDATE prescriptions SET order_status='DISPENSED',dispensed_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
  });
  try{tx();}catch(e){return res.status(409).json({error:e.message});}
 } else db.prepare("UPDATE prescriptions SET order_status='PENDING REVIEW',dispensed_at=NULL WHERE id=?").run(id);
 collectAlerts();res.json({ok:true});
});
router.get('/alerts',(_req,res)=>res.json(collectAlerts()));
router.post('/alerts/run',(_req,res)=>res.json({alerts:collectAlerts()}));
router.runScheduledAlerts = collectAlerts;
export default router;
