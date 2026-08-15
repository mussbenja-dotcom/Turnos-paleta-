import { useEffect, useState } from 'react';
import { api } from '../api/client';

const hoy = () => new Date().toISOString().slice(0, 10);

export default function Reservas() {
  const [fecha, setFecha] = useState(hoy());
  const [reservas, setReservas] = useState([]);
  const [msg, setMsg] = useState('');

  const cargar = () => api.reservas(fecha).then(setReservas).catch((e) => setMsg(e.message));
  useEffect(() => { cargar(); }, [fecha]);

  const fmt = (iso) => new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

  const pagar = async (id) => {
    const medioPago = prompt('Medio de pago (efectivo / transferencia / tarjeta):', 'efectivo');
    if (!medioPago) return;
    await api.registrarPago(id, { medioPago });
    cargar();
  };

  const cancelar = async (id) => {
    if (!confirm('¿Cancelar esta reserva? El turno vuelve a estar disponible.')) return;
    await api.cancelarReserva(id);
    cargar();
  };

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>Reservas</h2>
        <input type="date" style={{ width: 180 }} value={fecha} onChange={(e) => setFecha(e.target.value)} />
      </div>
      {msg && <p className="muted">{msg}</p>}
      <table>
        <thead>
          <tr><th>Horario</th><th>Cancha</th><th>Cliente</th><th>Teléfono</th><th>Tipo</th><th>Pago</th><th></th></tr>
        </thead>
        <tbody>
          {reservas.map((r) => (
            <tr key={r.id}>
              <td>{fmt(r.inicio)} - {fmt(r.fin)}</td>
              <td>{r.cancha} <span className="muted">({r.deporte})</span></td>
              <td>{r.cliente_nombre || '—'}</td>
              <td>{r.telefono}</td>
              <td>{r.tipo === 'evento' ? <span className="badge evento">{r.descripcion || 'Evento'}</span> : 'Estándar'}</td>
              <td>{r.pagado ? <span className="badge pagado">{r.medio_pago}</span> : <span className="badge impago">Impago</span>}</td>
              <td style={{ display: 'flex', gap: 6 }}>
                {!r.pagado && <button className="small" onClick={() => pagar(r.id)}>Cobrar</button>}
                <button className="small" onClick={() => cancelar(r.id)}>Cancelar</button>
              </td>
            </tr>
          ))}
          {reservas.length === 0 && <tr><td colSpan="7" className="muted">Sin reservas para esta fecha</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
