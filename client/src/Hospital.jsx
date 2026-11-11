import { useEffect, useMemo, useState } from 'react';
import { api } from './api.js';
import { Icon } from './ui.jsx';

const emptyMedicine = { name: '', generic_name: '', strength: '', batch_no: '', quantity: '0', reorder_level: '10', expiry_date: '', unit_price: '' };
const emptyRx = { patient_name: '', patient_phone: '', doctor_name: '', diagnosis: '', medicines: [{ medicine_name: '', dosage: '', frequency: '', duration: '', quantity: '1' }], notes: '' };
const money = (n) => Number(n || 0).toLocaleString('en-PK');
const dateLabel = (v) => v ? new Date(`${v}T00:00:00`).toLocaleDateString('en-GB') : '—';

export default function Hospital() {
  const [tab, setTab] = useState('overview');
  const [stock, setStock] = useState([]);
  const [prescriptions, setPrescriptions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [medicineForm, setMedicineForm] = useState(emptyMedicine);
  const [rxForm, setRxForm] = useState(emptyRx);
  const [editing, setEditing] = useState(null);
  const [message, setMessage] = useState('');
  const [search, setSearch] = useState('');

  const load = async () => {
    try {
      const [s, p] = await Promise.all([api('/hospital/medicines'), api('/hospital/prescriptions')]);
      setStock(s); setPrescriptions(p);
    } catch (e) { setMessage(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const today = new Date(); today.setHours(0,0,0,0);
  const soon = new Date(today); soon.setDate(soon.getDate() + 30);
  const lowStock = stock.filter(m => Number(m.quantity) <= Number(m.reorder_level));
  const expiring = stock.filter(m => m.expiry_date && new Date(`${m.expiry_date}T00:00:00`) <= soon);
  const filteredStock = useMemo(() => stock.filter(m => `${m.name} ${m.generic_name || ''} ${m.batch_no || ''}`.toLowerCase().includes(search.toLowerCase())), [stock, search]);

  async function saveMedicine(e) {
    e.preventDefault();
    try {
      const body = { ...medicineForm, quantity: Number(medicineForm.quantity), reorder_level: Number(medicineForm.reorder_level), unit_price: Number(medicineForm.unit_price || 0) };
      await api(editing ? `/hospital/medicines/${editing}` : '/hospital/medicines', editing ? 'PUT' : 'POST', body);
      setMedicineForm(emptyMedicine); setEditing(null); setMessage('Medicine saved successfully.'); await load();
    } catch (e) { setMessage(e.message); }
  }
  async function deleteMedicine(id) {
    if (!confirm('Delete this medicine record?')) return;
    try { await api(`/hospital/medicines/${id}`, 'DELETE'); await load(); }
    catch (e) { setMessage(e.message); }
  }
  function updateRxMedicine(i, key, value) {
    setRxForm(f => ({ ...f, medicines: f.medicines.map((m, n) => n === i ? { ...m, [key]: value } : m) }));
  }
  async function savePrescription(e) {
    e.preventDefault();
    if (!rxForm.patient_name.trim() || !rxForm.doctor_name.trim() || !rxForm.medicines.some(m => m.medicine_name.trim())) {
      setMessage('Patient name, doctor name and at least one medicine are required.'); return;
    }
    try {
      await api('/hospital/prescriptions', 'POST', rxForm);
      setRxForm(emptyRx); setMessage('Prescription saved. Pharmacy order created as PENDING REVIEW.'); await load(); setTab('prescriptions');
    } catch (e) { setMessage(e.message); }
  }
  async function updateOrder(id, status) {
    try { await api(`/hospital/orders/${id}`, 'PATCH', { status }); await load(); }
    catch (e) { setMessage(e.message); }
  }

  return <div className="hospital-page">
    <header className="hospital-hero">
      <div><span className="hospital-kicker">CARE OPERATIONS</span><h1>Hospital Management</h1><p>Pharmacy inventory, e-prescriptions and safety alerts in one workspace.</p>
        <div className="hospital-hero-pills"><span><i/> Inventory monitoring</span><span>Prescription workflow</span><span>Expiry tracking</span></div>
      </div><div className="hospital-hero-icon"><Icon name="alert" size={58}/></div>
    </header>

    <nav className="hospital-tabs">
      {[['overview','Overview'],['inventory','Pharmacy stock'],['prescriptions','E-prescriptions'],['new-rx','New prescription']].map(([k,l]) => <button key={k} className={tab===k?'active':''} onClick={()=>setTab(k)}>{l}</button>)}
    </nav>

    {message && <div className="hospital-notice"><span>{message}</span><button onClick={()=>setMessage('')}>×</button></div>}

    {tab === 'overview' && <>
      <div className="hospital-stats">
        <article><span>Total medicines</span><strong>{stock.length}</strong><small>Stock catalogue</small></article>
        <article className="h-warn"><span>Low stock alerts</span><strong>{lowStock.length}</strong><small>At or below reorder level</small></article>
        <article className="h-danger"><span>Expiry alerts</span><strong>{expiring.length}</strong><small>Expired or expiring within 30 days</small></article>
        <article><span>E-prescriptions</span><strong>{prescriptions.length}</strong><small>Saved records</small></article>
      </div>
      <div className="hospital-grid-two">
        <section className="hospital-panel"><div className="hospital-panel-head"><div><span className="hospital-kicker">ATTENTION REQUIRED</span><h2>Low stock medicines</h2></div><button onClick={()=>setTab('inventory')}>View stock →</button></div>
          {lowStock.length ? lowStock.map(m=><div className="hospital-alert-row" key={m.id}><div><strong>{m.name}</strong><small>Reorder level: {m.reorder_level}</small></div><b>{m.quantity} left</b></div>) : <p className="hospital-empty">No low-stock medicines right now.</p>}
        </section>
        <section className="hospital-panel"><div className="hospital-panel-head"><div><span className="hospital-kicker">30-DAY WINDOW</span><h2>Expiry alerts</h2></div><button onClick={()=>setTab('inventory')}>View stock →</button></div>
          {expiring.length ? expiring.map(m=><div className="hospital-alert-row" key={m.id}><div><strong>{m.name}</strong><small>Batch: {m.batch_no || '—'}</small></div><b>{dateLabel(m.expiry_date)}</b></div>) : <p className="hospital-empty">No medicines expiring in the next 30 days.</p>}
        </section>
      </div>
      <section className="hospital-panel hospital-safety"><Icon name="alert" size={22}/><div><strong>Clinical safety check</strong><p>Every prescription must be reviewed by a licensed doctor/pharmacist. This portal does not independently validate drug interactions, allergies, dosage or treatment suitability.</p></div></section>
    </>}

    {tab === 'inventory' && <>
      <div className="hospital-section-title"><div><span className="hospital-kicker">PHARMACY</span><h2>Medicine inventory</h2><p>Add medicines and monitor quantity, batches and expiry dates.</p></div></div>
      <form className="hospital-form hospital-medicine-form" onSubmit={saveMedicine}>
        <h3>{editing ? 'Update medicine' : 'Add medicine to stock'}</h3>
        <div className="hospital-fields">
          <label>Medicine name<input required value={medicineForm.name} onChange={e=>setMedicineForm({...medicineForm,name:e.target.value})} placeholder="e.g. Paracetamol"/></label>
          <label>Generic name<input value={medicineForm.generic_name} onChange={e=>setMedicineForm({...medicineForm,generic_name:e.target.value})} placeholder="Generic / active ingredient"/></label>
          <label>Strength<input value={medicineForm.strength} onChange={e=>setMedicineForm({...medicineForm,strength:e.target.value})} placeholder="e.g. 500 mg"/></label>
          <label>Batch number<input value={medicineForm.batch_no} onChange={e=>setMedicineForm({...medicineForm,batch_no:e.target.value})}/></label>
          <label>Quantity<input required type="number" min="0" value={medicineForm.quantity} onChange={e=>setMedicineForm({...medicineForm,quantity:e.target.value})}/></label>
          <label>Low-stock threshold<input type="number" min="0" value={medicineForm.reorder_level} onChange={e=>setMedicineForm({...medicineForm,reorder_level:e.target.value})}/></label>
          <label>Expiry date<input type="date" value={medicineForm.expiry_date} onChange={e=>setMedicineForm({...medicineForm,expiry_date:e.target.value})}/></label>
          <label>Unit price (PKR)<input type="number" min="0" step="0.01" value={medicineForm.unit_price} onChange={e=>setMedicineForm({...medicineForm,unit_price:e.target.value})}/></label>
        </div>
        <div className="hospital-form-actions"><button className="hospital-primary">{editing ? 'Save changes' : 'Add medicine'}</button>{editing && <button type="button" onClick={()=>{setEditing(null);setMedicineForm(emptyMedicine)}}>Cancel</button>}</div>
      </form>
      <section className="hospital-panel"><div className="hospital-panel-head"><h2>Stock list</h2><input className="hospital-search" placeholder="Search medicine..." value={search} onChange={e=>setSearch(e.target.value)}/></div>
        <div className="hospital-table-wrap"><table className="hospital-table"><thead><tr><th>Medicine</th><th>Batch</th><th>Quantity</th><th>Reorder at</th><th>Expiry</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {filteredStock.map(m=><tr key={m.id}><td><strong>{m.name}</strong><small>{m.generic_name || ''} {m.strength || ''}</small></td><td>{m.batch_no || '—'}</td><td>{m.quantity}</td><td>{m.reorder_level}</td><td>{dateLabel(m.expiry_date)}</td><td>{m.expiry_date && new Date(`${m.expiry_date}T00:00:00`) < today ? <span className="h-status danger">Expired</span> : Number(m.quantity)<=Number(m.reorder_level) ? <span className="h-status warn">Low stock</span> : <span className="h-status good">Available</span>}</td><td><button className="h-small-btn" onClick={()=>{setEditing(m.id);setMedicineForm({...m,quantity:String(m.quantity),reorder_level:String(m.reorder_level),unit_price:String(m.unit_price||'')});window.scrollTo({top:0,behavior:'smooth'})}}>Edit</button> <button className="h-small-btn danger" onClick={()=>deleteMedicine(m.id)}>Delete</button></td></tr>)}
        </tbody></table>{!filteredStock.length && <p className="hospital-empty">No medicines found. Add your first medicine above.</p>}</div>
      </section>
    </>}

    {tab === 'new-rx' && <>
      <div className="hospital-section-title"><div><span className="hospital-kicker">DOCTOR WORKFLOW</span><h2>Create e-prescription</h2><p>Save the prescription and prepare a pharmacy order for review.</p></div></div>
      <form className="hospital-form" onSubmit={savePrescription}>
        <div className="hospital-fields"><label>Patient name<input required value={rxForm.patient_name} onChange={e=>setRxForm({...rxForm,patient_name:e.target.value})}/></label><label>Patient phone<input value={rxForm.patient_phone} onChange={e=>setRxForm({...rxForm,patient_phone:e.target.value})} placeholder="03XX XXXXXXX"/></label><label>Prescribing doctor<input required value={rxForm.doctor_name} onChange={e=>setRxForm({...rxForm,doctor_name:e.target.value})}/></label><label>Diagnosis / reason<input value={rxForm.diagnosis} onChange={e=>setRxForm({...rxForm,diagnosis:e.target.value})}/></label></div>
        <div className="hospital-panel-head rx-head"><h3>Prescribed medicines</h3><button type="button" onClick={()=>setRxForm(f=>({...f,medicines:[...f.medicines,{medicine_name:'',dosage:'',frequency:'',duration:'',quantity:'1'}]}))}>+ Add medicine</button></div>
        {rxForm.medicines.map((m,i)=><div className="rx-medicine" key={i}><div className="rx-medicine-title">Medicine {i+1}{i>0 && <button type="button" onClick={()=>setRxForm(f=>({...f,medicines:f.medicines.filter((_,n)=>n!==i)}))}>Remove</button>}</div><div className="hospital-fields"><label>Medicine<input value={m.medicine_name} onChange={e=>updateRxMedicine(i,'medicine_name',e.target.value)} placeholder="Medicine name"/></label><label>Dose / strength<input value={m.dosage} onChange={e=>updateRxMedicine(i,'dosage',e.target.value)} placeholder="As prescribed"/></label><label>Frequency<input value={m.frequency} onChange={e=>updateRxMedicine(i,'frequency',e.target.value)} placeholder="As prescribed"/></label><label>Duration<input value={m.duration} onChange={e=>updateRxMedicine(i,'duration',e.target.value)} placeholder="As prescribed"/></label><label>Quantity<input type="number" min="1" value={m.quantity} onChange={e=>updateRxMedicine(i,'quantity',e.target.value)}/></label></div></div>)}
        <label className="hospital-notes-label">Doctor notes<textarea rows="3" value={rxForm.notes} onChange={e=>setRxForm({...rxForm,notes:e.target.value})}/></label>
        <div className="hospital-safety inline"><Icon name="alert"/><p>Before dispensing: verify patient identity, allergies, dosage, contraindications and drug interactions using an approved clinical reference. Pharmacy order will remain pending review.</p></div>
        <button className="hospital-primary">Save prescription & create pharmacy order</button>
      </form>
    </>}

    {tab === 'prescriptions' && <><div className="hospital-section-title"><div><span className="hospital-kicker">PRESCRIPTION REGISTER</span><h2>E-prescriptions & pharmacy orders</h2><p>Orders are created automatically when a prescription is saved.</p></div><button className="hospital-primary" onClick={()=>setTab('new-rx')}>+ New prescription</button></div>
      <section className="hospital-panel"><div className="hospital-table-wrap"><table className="hospital-table"><thead><tr><th>Patient</th><th>Doctor</th><th>Prescription</th><th>Created</th><th>Pharmacy order</th><th>Action</th></tr></thead><tbody>{prescriptions.map(p=><tr key={p.id}><td><strong>{p.patient_name}</strong><small>{p.patient_phone || 'No phone'}</small></td><td>{p.doctor_name}</td><td>{(p.medicines || []).map(m=>m.medicine_name).join(', ')}</td><td>{new Date(p.created_at).toLocaleString()}</td><td><span className={`h-status ${p.order_status==='DISPENSED'?'good':'warn'}`}>{p.order_status || 'PENDING REVIEW'}</span></td><td>{p.order_status!=='DISPENSED' && <button className="h-small-btn" onClick={()=>updateOrder(p.id,'DISPENSED')}>Mark reviewed & dispensed</button>}</td></tr>)}</tbody></table>{!prescriptions.length && <p className="hospital-empty">No prescriptions created yet.</p>}</div></section>
    </>}
    {loading && <div className="hospital-loading">Loading hospital data…</div>}
  </div>;
}
