import { useState } from 'react';
import Canchas from './pages/Canchas.jsx';
import Reservas from './pages/Reservas.jsx';
import Eventos from './pages/Eventos.jsx';

export default function App() {
  const [tab, setTab] = useState('canchas');

  return (
    <div className="app">
      <h1>🎾 Panel de Turnos</h1>
      <p className="muted">Gestión de canchas, reservas y eventos</p>

      <div className="tabs">
        <button className={`tab ${tab === 'canchas' ? 'active' : ''}`} onClick={() => setTab('canchas')}>Canchas</button>
        <button className={`tab ${tab === 'reservas' ? 'active' : ''}`} onClick={() => setTab('reservas')}>Reservas</button>
        <button className={`tab ${tab === 'eventos' ? 'active' : ''}`} onClick={() => setTab('eventos')}>Eventos</button>
      </div>

      {tab === 'canchas' && <Canchas />}
      {tab === 'reservas' && <Reservas />}
      {tab === 'eventos' && <Eventos />}
    </div>
  );
}
