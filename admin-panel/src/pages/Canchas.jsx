import { useEffect, useState } from 'react';
import { api } from '../api/client';

const VACIA = { club_id: 1, nombre: '', tipo: 'padel', hora_apertura: '09:00', hora_cierre: '23:00', duracion_min: 90, precio: 8000 };

export default function Canchas() {
  const [canchas, setCanchas] = useState([]);
  const [form, setForm] = useState(VACIA);
  const [msg, setMsg] = useState('');

  const cargar = () => api.listCanchas().then(setCanchas).catch((e) => setMsg(e.message));
  useEffect(() => { cargar(); }, []);

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const guardar = async () => {
    try {
      await api.crearCancha(form);
      setForm(VACIA);
      setMsg('Cancha creada ✓');
      cargar();
    } catch (e) { setMsg(e.message); }
  };

  const borrar = async (id) => {
    if (!confirm('¿Eliminar esta cancha?')) return;
    await api.borrarCancha(id);
    cargar();
  };

  const generar = async () => {
    const { generados } = await api.generarProximos(7);
    setMsg(`Se generaron ${generados} turnos para los próximos 7 días ✓`);
  };

  return (
    <div>
      <div className="card">
        <h2>Nueva cancha</h2>
        <div className="form-row">
          <div>
            <label>Nombre</label>
            <input value={form.nombre} onChange={set('nombre')} placeholder="Cancha 1" />
          </div>
          <div>
            <label>Tipo</label>
            <select value={form.tipo} onChange={set('tipo')}>
              <option value="padel">Pádel</option>
              <option value="paleta">Paleta</option>
              <option value="tenis">Tenis</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div><label>Apertura</label><input type="time" value={form.hora_apertura} onChange={set('hora_apertura')} /></div>
          <div><label>Cierre</label><input type="time" value={form.hora_cierre} onChange={set('hora_cierre')} /></div>
        </div>
        <div className="form-row">
          <div><label>Duración turno (min)</label><input type="number" value={form.duracion_min} onChange={set('duracion_min')} /></div>
          <div><label>Precio</label><input type="number" value={form.precio} onChange={set('precio')} /></div>
        </div>
        <button className="primary" onClick={guardar}>Crear cancha</button>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Canchas</h2>
          <button className="primary" style={{ marginTop: 0 }} onClick={generar}>Generar turnos (7 días)</button>
        </div>
        {msg && <p className="muted" style={{ marginTop: 8 }}>{msg}</p>}
        <table>
          <thead>
            <tr><th>Nombre</th><th>Tipo</th><th>Horario</th><th>Turno</th><th>Precio</th><th></th></tr>
          </thead>
          <tbody>
            {canchas.map((c) => (
              <tr key={c.id}>
                <td>{c.nombre}</td>
                <td>{c.tipo}</td>
                <td>{c.hora_apertura?.slice(0,5)} - {c.hora_cierre?.slice(0,5)}</td>
                <td>{c.duracion_min} min</td>
                <td>${c.precio}</td>
                <td><button className="small" onClick={() => borrar(c.id)}>Eliminar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
