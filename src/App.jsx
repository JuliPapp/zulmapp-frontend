import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import './App.css';

// Configuración de Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// URL del backend
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const App = () => {
  // Estados
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState('pedidos'); // 'pedidos' o 'cocina'
  const [currentOrder, setCurrentOrder] = useState(null);
  const [stats, setStats] = useState({ totalOrders: 0, menuStats: {}, peopleList: [] });
  const [kitchenData, setKitchenData] = useState({ dishes: [], totalDishes: 0, totalPeople: 0 });
  const [message, setMessage] = useState({ text: '', type: '' });
  const [formLoading, setFormLoading] = useState(false);
  const [menuItems, setMenuItems] = useState([]);
  const [autoUpdate, setAutoUpdate] = useState(true);
  
  // Estados del formulario - Solo 2 platos
  const [formData, setFormData] = useState({
    nombre: '',
    plato1: '',
    plato2: '',
    custom1: '',
    custom2: ''
  });

  // Verificar sesión al cargar
  useEffect(() => {
    getSession();
  }, []);

  // Cargar datos cuando el usuario está autenticado
  useEffect(() => {
    if (user) {
      loadMenu();
      loadCurrentOrder();
      loadStats();
      loadKitchenData();
    }
  }, [user]);

  // Auto-actualización cada 30 segundos
  useEffect(() => {
    if (user && autoUpdate && currentView === 'cocina') {
      const interval = setInterval(() => {
        loadKitchenData();
      }, 30000); // 30 segundos

      return () => clearInterval(interval);
    }
  }, [user, autoUpdate, currentView]);

  const getSession = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
    } catch (error) {
      console.error('Error obteniendo sesión:', error);
    } finally {
      setLoading(false);
    }
  };

  const signInWithGoogle = async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: window.location.origin
        }
      });
      if (error) throw error;
    } catch (error) {
      showMessage('Error al iniciar sesión: ' + error.message, 'error');
    }
  };

  const signOut = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
      setCurrentOrder(null);
      setStats({ totalOrders: 0, menuStats: {}, peopleList: [] });
      setKitchenData({ dishes: [], totalDishes: 0, totalPeople: 0 });
    } catch (error) {
      console.error('Error al cerrar sesión:', error);
    }
  };

  const apiCall = async (endpoint, options = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...options.headers,
      },
    });

    return response.json();
  };

  const loadMenu = async () => {
    try {
      const result = await apiCall('/api/menu');
      if (result.success) {
        setMenuItems(result.menuItems);
      }
    } catch (error) {
      console.error('Error cargando menú:', error);
    }
  };

  const loadCurrentOrder = async () => {
    try {
      const result = await apiCall('/api/pedidos/current');
      if (result.success && result.order) {
        setCurrentOrder(result.order);
        setFormData({
          nombre: result.order.nombre || '',
          plato1: result.order.plato1 || '',
          plato2: result.order.plato2 || '',
          custom1: '',
          custom2: ''
        });
      }
    } catch (error) {
      console.error('Error cargando pedido actual:', error);
    }
  };

  const loadStats = async () => {
    try {
      const result = await apiCall('/api/stats');
      if (result.success) {
        setStats(result.stats);
      }
    } catch (error) {
      console.error('Error cargando estadísticas:', error);
    }
  };

  const loadKitchenData = async () => {
    try {
      const result = await apiCall('/api/stats');
      if (result.success) {
        const stats = result.stats;
        
        // Obtener todos los pedidos para calcular orden de platos
        const today = new Date().toISOString().split('T')[0];
        const { data: pedidos, error } = await supabase
          .from('pedidos')
          .select('*')
          .eq('fecha', today)
          .order('timestamp', { ascending: true });

        if (!error && pedidos) {
          const allDishes = [];
          
          // Procesar todos los pedidos para obtener orden cronológico - Solo plato1 y plato2
          pedidos.forEach(pedido => {
            [pedido.plato1, pedido.plato2].forEach(plato => {
              if (plato && plato.trim() !== '') {
                allDishes.push({
                  plato: plato.trim(),
                  nombre: pedido.nombre,
                  usuario: pedido.usuario,
                  timestamp: pedido.timestamp
                });
              }
            });
          });

          setKitchenData({
            dishes: allDishes,
            totalDishes: allDishes.length,
            totalPeople: stats.totalOrders
          });
        }
      }
    } catch (error) {
      console.error('Error cargando datos de cocina:', error);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setFormLoading(true);

    try {
      const orderData = {
        nombre: formData.nombre,
        plato1: getRealPlatoValue(1),
        plato2: getRealPlatoValue(2)
      };

      const result = await apiCall('/api/pedidos', {
        method: 'POST',
        body: JSON.stringify(orderData)
      });

      if (result.success) {
        showMessage(result.message, 'success');
        loadCurrentOrder();
        loadStats();
        loadKitchenData(); // Actualizar también datos de cocina
      } else {
        showMessage(result.message, 'error');
      }
    } catch (error) {
      showMessage('Error al enviar pedido: ' + error.message, 'error');
    } finally {
      setFormLoading(false);
    }
  };

  const cancelOrder = async () => {
    if (!confirm('¿Estás seguro que querés cancelar tu pedido?\n\nEsta acción no se puede deshacer.')) {
      return;
    }

    setFormLoading(true);
    try {
      const result = await apiCall('/api/pedidos/current', { method: 'DELETE' });
      
      if (result.success) {
        showMessage(result.message, 'success');
        setCurrentOrder(null);
        setFormData({
          nombre: '',
          plato1: '',
          plato2: '',
          custom1: '',
          custom2: ''
        });
        loadStats();
        loadKitchenData(); // Actualizar también datos de cocina
      } else {
        showMessage(result.message, 'error');
      }
    } catch (error) {
      showMessage('Error al cancelar pedido: ' + error.message, 'error');
    } finally {
      setFormLoading(false);
    }
  };

  const copyKitchenList = () => {
    if (kitchenData.dishes.length === 0) {
      alert('No hay platos para copiar');
      return;
    }

    const listText = kitchenData.dishes
      .map((dish, index) => `${index + 1}. ${dish.plato} - ${dish.nombre}`)
      .join('\n');

    const fullText = `🍽️ LISTA DE COCINA - ${new Date().toLocaleDateString('es-AR')}\n\n${listText}\n\nTotal: ${kitchenData.totalDishes} platos para ${kitchenData.totalPeople} personas`;

    navigator.clipboard.writeText(fullText)
      .then(() => {
        showMessage('✅ Lista copiada al portapapeles', 'success');
      })
      .catch(() => {
        alert('❌ No se pudo copiar la lista');
      });
  };

  const getRealPlatoValue = (platoNumber) => {
    const selectValue = formData[`plato${platoNumber}`];
    const customValue = formData[`custom${platoNumber}`];
    
    if (selectValue === 'CUSTOM') {
      return customValue.trim();
    }
    return selectValue;
  };

  const handlePlatoChange = (platoNumber, value) => {
    setFormData(prev => ({
      ...prev,
      [`plato${platoNumber}`]: value,
      [`custom${platoNumber}`]: value === 'CUSTOM' ? prev[`custom${platoNumber}`] : ''
    }));
  };

  const showMessage = (text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 5000);
  };

const adminEmails = new Set([
  "juliandanielpappalettera@gmail.com",
  "leandro.binetti@gmail.com",
  "alanpablomarino@gmail.com"
]);

const isAdmin = () => {
  return adminEmails.has(user?.email);
};

  const checkTimeRestriction = () => {
    if (isAdmin()) return true;
    
    const now = new Date();
    const argTime = new Date(now.toLocaleString("en-US", {timeZone: "America/Argentina/Buenos_Aires"}));
    
    const dayOfWeek = argTime.getDay();
    const hour = argTime.getHours();
    const minute = argTime.getMinutes();
    
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const isInTimeRange = (hour === 7 || hour === 8 || hour === 9) || 
                         (hour === 10 && minute <= 15);
    
    return isWeekday && isInTimeRange;
  };

  const copiarYActuar = () => {
    if (!isAdmin() && !checkTimeRestriction()) {
      alert("⏰ La app solo está disponible de lunes a viernes de 7:00 a 10:15 AM");
      return;
    }
    
    const cvu = "0000003100093213450625";
    const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    const isAndroid = /Android/i.test(navigator.userAgent);
    
    navigator.clipboard.writeText(cvu)
      .then(() => {
        if (isAndroid) {
          alert("✅ CVU copiado. Vamos a abrir Mercado Pago...");
          window.location.href = "intent://home#Intent;scheme=mercadopago;package=com.mercadopago.wallet;end";
        } else if (isIOS) {
          alert("✅ CVU copiado.\nAhora abrí la app de Mercado Pago y pegalo para hacer la transferencia.");
        } else {
          alert("✅ CVU copiado.\nAbrí tu app bancaria o Mercado Pago y pegalo para transferir.");
        }
      })
      .catch(() => alert("❌ No se pudo copiar el CVU 😞"));
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Cargando...</p>
      </div>
    );
  }

  // Pantalla de login - SIN palabra clave
  if (!user) {
    return (
      <div className="login-screen">
        <div className="container">
          <div className="header">
            <h1>🍽️ Zulmapp</h1>
            <p>Sistema de pedidos de comida</p>
          </div>
          <div className="login-content">
            <p>Iniciá sesión con tu cuenta de Google para hacer tu pedido</p>
            <button onClick={signInWithGoogle} className="btn login-btn">
              🔐 Iniciar sesión con Google
            </button>
          </div>
        </div>
      </div>
    );
  }

  const timeAllowed = checkTimeRestriction();
  const currentTime = new Date().toLocaleString('es-AR', {timeZone: 'America/Argentina/Buenos_Aires'});

  // VISTA DE DISPLAY DE COCINA
  if (currentView === 'cocina') {
    return (
      <div className="container">
        <div className="header">
          <h1>🍽️ Display de Cocina</h1>
          <div className="kitchen-info">
            <strong>📅 {new Date().toLocaleDateString('es-AR', { 
              weekday: 'long', 
              day: 'numeric', 
              month: 'long', 
              year: 'numeric' 
            })} - {currentTime}</strong>
            <div className="kitchen-stats">
              <span className="stat-number">{kitchenData.totalDishes}</span>
              <span className="stat-label">Platos</span>
              <span className="stat-number">{kitchenData.totalPeople}</span>
              <span className="stat-label">Personas</span>
            </div>
          </div>
        </div>

        <div className="kitchen-controls">
          <button onClick={loadKitchenData} className="btn kitchen-btn">
            🔄 Actualizar
          </button>
          <button onClick={copyKitchenList} className="btn kitchen-btn success">
            📋 Copiar Lista
          </button>
          <label className="auto-update-toggle">
            <input 
              type="checkbox" 
              checked={autoUpdate}
              onChange={(e) => setAutoUpdate(e.target.checked)}
            />
            Auto-actualizar
          </label>
          <button 
            onClick={() => setCurrentView('pedidos')} 
            className="btn kitchen-btn secondary"
          >
            👤 Ver Pedidos
          </button>
        </div>

        {message.text && (
          <div className={`message ${message.type}`}>
            {message.text}
          </div>
        )}

        <div className="kitchen-display">
          {kitchenData.dishes.length === 0 ? (
            <div className="no-dishes">
              <div className="empty-icon">🍽️</div>
              <h3>No hay platos registrados para hoy</h3>
              <p>Última actualización: {currentTime.split(',')[1]}</p>
            </div>
          ) : (
            <div className="dishes-list">
              {kitchenData.dishes.map((dish, index) => (
                <div key={index} className="dish-item">
                  <div className="dish-number">{index + 1}</div>
                  <div className="dish-details">
                    <div className="dish-name">{dish.plato}</div>
                    <div className="dish-person">{dish.nombre}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // VISTA PRINCIPAL DE PEDIDOS
  return (
    <div className="container">
      <div className="header">
        <h1>🍽️ Zulmapp</h1>
        <div className="user-info">
          <strong>👤 Usuario:</strong> {user.user_metadata?.name || user.email} ({user.email})
          <br />
          <strong>📅 Fecha:</strong> {new Date().toLocaleDateString('es-AR')}
          <br />
          <strong>🕐 Hora:</strong> {currentTime}
          <br />
          <button onClick={signOut} className="btn-link">
            🚪 Cerrar sesión
          </button>
          <br />
          <button onClick={() => setCurrentView('cocina')} className="btn-link">
            🍽️ Display de Cocina
          </button>
        </div>
      </div>

      {/* Control de horarios */}
      <div className="time-status">
        {isAdmin() ? (
          <div className="time-info admin-mode">
            👑 MODO ADMINISTRADOR - Acceso total sin restricciones
            <br />
            <small>Hora actual: {currentTime}</small>
          </div>
        ) : timeAllowed ? (
          <div className="time-info">
            ✅ App disponible - Podés hacer tu pedido
          </div>
        ) : (
          <div className="time-restriction">
            ⏰ La app solo está disponible de lunes a viernes de 7:00 a 10:15 AM
            <br />
            <small>Hora actual: {currentTime}</small>
          </div>
        )}
      </div>

      <div className={`form-container ${!timeAllowed && !isAdmin() ? 'disabled-overlay' : ''}`}>
        {message.text && (
          <div className={`message ${message.type}`}>
            {message.text}
          </div>
        )}

        {/* Pedido actual */}
        {currentOrder && (
          <div className="current-order">
            <h3>📋 Tu Pedido Actual</h3>
            <div style={{ marginBottom: '10px' }}>
              <strong>👤 Nombre:</strong> {currentOrder.nombre}
            </div>
            <ul className="dish-list">
              {currentOrder.plato1 && <li>{currentOrder.plato1}</li>}
              {currentOrder.plato2 && <li>{currentOrder.plato2}</li>}
            </ul>
            {currentOrder.dishNumbers && currentOrder.dishNumbers.length > 0 && (
              <div className="dish-numbers-info">
                <strong>🔢 {currentOrder.dishNumbers.length === 1 ? 'Tu plato en la cocina:' : 'Tus platos en la cocina:'}</strong>{' '}
                {currentOrder.dishNumbers.length === 1 
                  ? `Número ${currentOrder.dishNumbers[0]}`
                  : `Números ${currentOrder.dishNumbers.join(', ')}`
                }
              </div>
            )}
            <p><small>💡 Puedes modificar tu pedido enviando el formulario nuevamente</small></p>
          </div>
        )}

        {formLoading ? (
          <div className="loading">
            <div className="spinner"></div>
            <p>Procesando pedido...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            {/* Campo nombre */}
            <div className="form-group">
              <label htmlFor="nombre">👤 Tu Nombre *</label>
              <input
                type="text"
                id="nombre"
                value={formData.nombre}
                onChange={(e) => setFormData(prev => ({ ...prev, nombre: e.target.value }))}
                placeholder="Escribe tu nombre completo..."
                required
              />
            </div>

            {/* Plato 1 */}
            <div className="form-group">
              <label htmlFor="plato1">🍽️ Plato Principal *</label>
              <select
                id="plato1"
                value={formData.plato1}
                onChange={(e) => handlePlatoChange(1, e.target.value)}
                required
              >
                <option value="">Seleccionar plato...</option>
                {menuItems.map((item, index) => (
                  <option key={index} value={item}>{item}</option>
                ))}
                <option value="CUSTOM">📝 Escribir otro plato...</option>
              </select>
              {formData.plato1 === 'CUSTOM' && (
                <input
                  type="text"
                  value={formData.custom1}
                  onChange={(e) => setFormData(prev => ({ ...prev, custom1: e.target.value }))}
                  placeholder="Escribe tu plato personalizado..."
                  required
                />
              )}
            </div>

            {/* Plato 2 */}
            <div className="form-group">
              <label htmlFor="plato2">🍽️ Segundo Plato (Opcional)</label>
              <select
                id="plato2"
                value={formData.plato2}
                onChange={(e) => handlePlatoChange(2, e.target.value)}
              >
                <option value="">Sin segundo plato</option>
                {menuItems.map((item, index) => (
                  <option key={index} value={item}>{item}</option>
                ))}
                <option value="CUSTOM">📝 Escribir otro plato...</option>
              </select>
              {formData.plato2 === 'CUSTOM' && (
                <input
                  type="text"
                  value={formData.custom2}
                  onChange={(e) => setFormData(prev => ({ ...prev, custom2: e.target.value }))}
                  placeholder="Escribe tu plato personalizado..."
                />
              )}
            </div>

            <button type="submit" className="btn">
              {currentOrder ? '✏️ Actualizar Pedido' : '📝 Enviar Pedido'}
            </button>

            {currentOrder && (
              <button
                type="button"
                className="btn cancel-btn"
                onClick={cancelOrder}
              >
                🗑️ Cancelar Pedido
              </button>
            )}
          </form>
        )}

        {/* Botón transferencia */}
        <button onClick={copiarYActuar} className="btn transfer-btn">
          📋 Copiar CVU y continuar
        </button>
      </div>

      {/* Estadísticas */}
      <div className={`stats-container ${!timeAllowed && !isAdmin() ? 'disabled-overlay' : ''}`}>
        <div className="stats-title">📊 Estadísticas del Día</div>
        <div className="stats-grid">
          <div className="stat-item">
            <h4>📊 Total de Pedidos</h4>
            <h2 style={{ color: '#667eea' }}>{stats.totalOrders}</h2>
          </div>

          {Object.keys(stats.menuStats).length > 0 && (
            <div className="stat-item">
              <h4>🏆 Platos Más Pedidos</h4>
              {Object.entries(stats.menuStats)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([dish, count]) => (
                  <div key={dish} style={{ margin: '5px 0' }}>
                    <strong>{dish}</strong>: {count} pedidos
                  </div>
                ))}
            </div>
          )}

          {stats.peopleList.length > 0 && (
            <div className="stat-item">
              <h4>👥 Personas que han pedido</h4>
              <div className="people-list">
                {stats.peopleList.map((person, index) => (
                  <div key={index} className="people-item">
                    <strong>{person.nombre}</strong><br />
                    <small>{person.usuario} - {new Date(person.timestamp).toLocaleTimeString('es-ES')}</small>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
