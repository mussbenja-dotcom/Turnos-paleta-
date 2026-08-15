import { useEffect, useState } from 'react';
import { api } from '../api/client';

export default function Eventos() {
  const [canchas, setCanchas] = useState([]);
  const [form, setForm] = useState({ canchaId: '', fecha: '', horaInicio: '18:00', horaFin: '22:00', descripcion: '' });
  const [msg, setMsg] = useState('');

  useEffect(() => { api.listCanchas().then((cs) => { setCanchas(cs); if (cs[0]) setForm((f) => ({ ...f, canchaId: cs[0].id })); }); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const bloquear = async () => {
    try {
      const inicio = new Date(`${form.fecha}T${form.horaInicio}:00-03:00`).toISOString();
      const fin = new Date(`${form.fecha}T${form.horaFin}:00-03:00`).toISOString();
      const r = await api.bloquearEvento({ canchaId: form.canchaId, inicio, fin, descripcion: form.descripcion });
      setMsg(`Se bloquearon ${r.bloqueados} turnos para "${form.descripcion}" ✓`);
    } catch (e) { setMsg(e.message); }
  };

  return (
    <div className="card">
      <h2>Bloquear cancha para evento</h2>
      <p className="muted">Cumpleaños, torneos u otros eventos que ocupan la cancha más tiempo que un turno estándar.</p>

      <div className="form-row">
        <div>
          <label>Cancha</label>
          <select value={form.canchaId} onChange={set('canchaId')}>
            {canchas.map((c) => <option key={c.id} value={c.id}>{c.nombre} ({c.tipo})</option>)}
          </select>
        </div>
        <div><label>Fecha</label><input type="date" value={form.fecha} onChange={set('fecha')} /></div>
      </div>
      <div className="form-row">
        <div><label>Desde</label><input type="time" value={form.horaInicio} onChange={set('horaInicio')} /></div>
        <div><label>Hasta</label><input type="time" value={form.horaFin} onChange={set('horaFin')} /></div>
      </div>
      <label>Descripción</label>
      <input value={form.descripcion} onChange={set('descripcion')} placeholder="Cumpleaños de Juan / Torneo interno" />

      <button className="primary" onClick={bloquear}>Bloquear turnos</button>
      {msg && <p className="muted" style={{ marginTop: 12 }}>{msg}</p>}
    </div>
  );
}
