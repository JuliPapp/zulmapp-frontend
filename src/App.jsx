import React, { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import './App.css';

// Configuración de Supabase
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Calcula la fecha del ciclo según la hora de Buenos Aires.
// Si ya son las 14:00 o más, devuelve la fecha de mañana; si no, devuelve la de hoy.
const getCycleDate = () => {
  const ahoraEnBA = new Date(
    new Date().toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })
  );
  const hora = ahoraEnBA.getHours();
  if (hora >= 14) {
    const mañana = new Date(ahoraEnBA);
    mañana.setDate(ahoraEnBA.getDate() + 1);
    return mañana.toISOString().split('T')[0];
  }
  return ahoraEnBA.toISOString().split('T')[0];
};

// API backend
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// Correos de admin configurables (separados por coma)
const ADMIN_EMAILS = (
  import.meta.env.VITE_ADMIN_EMAILS ||
  'juliandanielpappalettera@gmail.com,leandro.binetti@gmail.com,alanpablomarino@gmail.com'
)
  .split(',')
  .map((e) => e.trim())
  .filter(Boolean);

// Verifica si un usuario es administrador
const isAdminUser = (user) => ADMIN_EMAILS.includes(user?.email);

// Verifica si la hora está dentro de 14:00–10:15 (cerrado entre 10:15 y 14:00)
const isWithinOrderTime = () => {
  const now = new Date();
  const argTime = new Date(
    now.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' })
  );
  const day = argTime.getDay(); // 0=Domingo, 1=Lunes, ..., 6=Sábado
  const hour = argTime.getHours();
  const minute = argTime.getMinutes();

  const isWeekday = day >= 1 && day <= 5; // Lunes a viernes
  const isFriday = day === 5;
  const isSaturday = day === 6;
  const isSunday = day === 0;
  const isMonday = day === 1;

  const after14 = hour >= 14;
  const before1015 = hour < 10 || (hour === 10 && minute <= 15);

  // Lógica normal de lunes a viernes
  if (isWeekday) return after14 || before1015;

  // Excepción: viernes después de las 14:00 hasta lunes 10:15
  if (isFriday && after14) return true;
  if ((isSaturday || isSunday) || (isMonday && before1015)) return true;

  return false;
};

// Llamada autenticada a la API
const apiCall = async (endpoint, options = {}) => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const token = session?.access_token;
  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }
  return response.json();
};

const App = () => {
  // Estados principales
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [currentView, setCurrentView] = useState(() => localStorage.getItem('zulmapp-view') || 'pedidos');
  const [currentOrder, setCurrentOrder] = useState(null);
  const [stats, setStats] = useState({ totalOrders: 0, menuStats: {}, peopleList: [] });
  const [kitchenData, setKitchenData] = useState({ dishes: [], totalDishes: 0, totalPeople: 0 });
  const [menuItems, setMenuItems] = useState([]);
  const [formData, setFormData] = useState({
    nombre: '',
    plato1: '',
    plato2: '',
    custom1: '',
    custom2: '',
  });
  const [message, setMessage] = useState({ text: '', type: '' });
  const [autoUpdate, setAutoUpdate] = useState(true);
  const [formLoading, setFormLoading] = useState(false);

  // Persistencia de vista
  useEffect(() => {
    localStorage.setItem('zulmapp-view', currentView);
  }, [currentView]);

  // Mostrar mensajes temporales
  const showMessage = useCallback((text, type) => {
    setMessage({ text, type });
    setTimeout(() => setMessage({ text: '', type: '' }), 5000);
  }, []);

  // Obtener sesión al iniciar
  const getSession = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
    } catch (err) {
      console.error('Error obteniendo sesión:', err);
      showMessage('Error al obtener la sesión', 'error');
    } finally {
      setLoading(false);
    }
  }, [showMessage]);

  useEffect(() => {
    getSession();
  }, [getSession]);

  // Iniciar sesión con Google
  const signInWithGoogle = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      });
      if (error) throw error;
    } catch (err) {
      showMessage(`Error al iniciar sesión: ${err.message}`, 'error');
    }
  }, [showMessage]);

  // Cerrar sesión
  const signOut = useCallback(async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      setUser(null);
      setCurrentOrder(null);
      setStats({ totalOrders: 0, menuStats: {}, peopleList: [] });
      setKitchenData({ dishes: [], totalDishes: 0, totalPeople: 0 });
    } catch (err) {
      console.error('Error al cerrar sesión:', err);
      showMessage('Error al cerrar sesión', 'error');
    }
  }, [showMessage]);

  // Cargar menú
  const loadMenu = useCallback(async () => {
    try {
      const result = await apiCall('/api/menu');
      if (result.success) {
        setMenuItems(result.menuItems);
      }
    } catch (err) {
      console.error('Error cargando menú:', err);
      showMessage('Error cargando menú', 'error');
    }
  }, [showMessage]);

  // Cargar pedido actual
  const loadCurrentOrder = useCallback(async () => {
    try {
      const result = await apiCall('/api/pedidos/current');
      if (result.success && result.order) {
        const order = result.order;
        setCurrentOrder(order);
        setFormData({
          nombre: order.nombre || '',
          plato1: order.plato1 || '',
          plato2: order.plato2 || '',
          custom1: '',
          custom2: '',
        });
      } else {
        setCurrentOrder(null);
      }
    } catch (err) {
      console.error('Error cargando pedido actual:', err);
      showMessage('Error cargando pedido actual', 'error');
    }
  }, [showMessage]);

  // Cargar estadísticas
  const loadStats = useCallback(async () => {
    try {
      const result = await apiCall('/api/stats');
      if (result.success) {
        setStats(result.stats);
      }
    } catch (err) {
      console.error('Error cargando estadísticas:', err);
      showMessage('Error cargando estadísticas', 'error');
    }
  }, [showMessage]);

  // Cargar datos de cocina - CORREGIDO: Solo usa el backend
  const loadKitchenData = useCallback(async () => {
    try {
      console.log('🔄 Cargando datos de cocina desde /api/stats...');
      const result = await apiCall('/api/stats');
      console.log('📊 Respuesta del backend:', result);

      if (result.success) {
        const statsRes = result.stats;
        const allDishes = [];

        console.log('👥 PeopleList recibida:', statsRes.peopleList);

        // Construir lista de platos desde peopleList
        if (statsRes.peopleList && statsRes.peopleList.length > 0) {
          statsRes.peopleList.forEach((pedido) => {
            console.log('🍽️ Procesando pedido:', pedido);
            [pedido.plato1, pedido.plato2].forEach((plato) => {
              if (plato && plato.trim()) {
                allDishes.push({
                  plato: plato.trim(),
                  nombre: pedido.nombre,
                  usuario: pedido.usuario,
                  timestamp: pedido.timestamp,
                });
              }
            });
          });
        }

        console.log('🍽️ Lista final de platos:', allDishes);

        setKitchenData({
          dishes: allDishes,
          totalDishes: allDishes.length,
          totalPeople: statsRes.totalOrders,
        });
      } else {
        console.error('❌ Backend devolvió success: false');
        showMessage('Error: respuesta inválida del servidor', 'error');
      }
    } catch (err) {
      console.error('💥 Error cargando datos de cocina:', err);
      showMessage(`Error cargando datos de cocina: ${err.message}`, 'error');
      // En caso de error, limpiar los datos
      setKitchenData({ dishes: [], totalDishes: 0, totalPeople: 0 });
    }
  }, [showMessage]);

  // Cargar datos al iniciar sesión
  useEffect(() => {
    if (user) {
      loadMenu();
      loadCurrentOrder();
      loadStats();
      loadKitchenData();
    }
  }, [user, loadMenu, loadCurrentOrder, loadStats, loadKitchenData]);

  // Auto actualización para la vista de cocina
  useEffect(() => {
    if (!user || !autoUpdate || currentView !== 'cocina') return;
    const interval = setInterval(() => {
      loadKitchenData();
      loadStats(); // También actualizamos stats para mantener consistencia
    }, 30000);
    return () => clearInterval(interval);
  }, [user, autoUpdate, currentView, loadKitchenData, loadStats]);

  // Obtener valor real de plato (custom vs selección)
  const getRealPlatoValue = useCallback(
    (num) => {
      const selectValue = formData[`plato${num}`];
      const customValue = formData[`custom${num}`];
      return selectValue === 'CUSTOM' ? customValue.trim() : selectValue;
    },
    [formData],
  );

  // Manejar cambios de plato
  const handlePlatoChange = useCallback((num, value) => {
    setFormData((prev) => ({
      ...prev,
      [`plato${num}`]: value,
      [`custom${num}`]: value === 'CUSTOM' ? prev[`custom${num}`] : '',
    }));
  }, []);

  // Enviar pedido
  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setFormLoading(true);
      try {
        const orderData = {
          nombre: formData.nombre,
          plato1: getRealPlatoValue(1),
          plato2: getRealPlatoValue(2),
        };
        const result = await apiCall('/api/pedidos', {
          method: 'POST',
          body: JSON.stringify(orderData),
        });
        if (result.success) {
          window.alert('¡Pagalo rata asquerosa! 🐀');
          showMessage(result.message, 'success');
          await Promise.all([
            loadCurrentOrder(),
            loadStats(),
            loadKitchenData()
          ]);
        } else {
          showMessage(result.message, 'error');
        }
      } catch (err) {
        showMessage(`Error al enviar pedido: ${err.message}`, 'error');
      } finally {
        setFormLoading(false);
      }
    },
    [formData, getRealPlatoValue, showMessage, loadCurrentOrder, loadStats, loadKitchenData],
  );

  // Cancelar pedido
  const cancelOrder = useCallback(
    async () => {
      if (
        !window.confirm(
          '¿Estás seguro que querés cancelar tu pedido?\n\nEsta acción no se puede deshacer.',
        )
      )
        return;
      setFormLoading(true);
      try {
        const result = await apiCall('/api/pedidos/current', { method: 'DELETE' });
        if (result.success) {
          showMessage(result.message, 'success');
          setCurrentOrder(null);
          setFormData({ nombre: '', plato1: '', plato2: '', custom1: '', custom2: '' });
          await Promise.all([
            loadStats(),
            loadKitchenData()
          ]);
        } else {
          showMessage(result.message, 'error');
        }
      } catch (err) {
        showMessage(`Error al cancelar pedido: ${err.message}`, 'error');
      } finally {
        setFormLoading(false);
      }
    },
    [showMessage, loadStats, loadKitchenData],
  );

  // Copiar lista de cocina
  const copyKitchenList = useCallback(() => {
    if (kitchenData.dishes.length === 0) {
      window.alert('No hay platos para copiar');
      return;
    }
    const listText = kitchenData.dishes
      .map((dish, idx) => `${idx + 1}. ${dish.plato} - ${dish.nombre}`)
      .join('\n');
    const fullText = `🍽️ LISTA DE COCINA - ${new Date().toLocaleDateString('es-AR')}\n\n${listText}\n\nTotal: ${kitchenData.totalDishes} platos para ${kitchenData.totalPeople} personas`;
    navigator.clipboard
      .writeText(fullText)
      .then(() => showMessage('✅ Lista copiada al portapapeles', 'success'))
      .catch(() => window.alert('❌ No se pudo copiar la lista'));
  }, [kitchenData, showMessage]);

  // Copiar CVU y abrir apps de pago
  const copiarYActuar = useCallback(
    () => {
      if (!isAdminUser(user) && !isWithinOrderTime()) {
        window.alert('⏰ La app solo está disponible de lunes a viernes de 14:00 a 10:15');
        return;
      }
      const cvu = '0000003100093213450625';
      const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      const isAndroid = /Android/i.test(navigator.userAgent);
      navigator.clipboard
        .writeText(cvu)
        .then(() => {
          if (isAndroid) {
            window.alert('✅ CVU copiado. Vamos a abrir Mercado Pago...');
            window.location.href =
              'intent://home#Intent;scheme=mercadopago;package=com.mercadopago.wallet;end';
          } else if (isIOS) {
            window.alert(
              '✅ CVU copiado.\nAhora abrí la app de Mercado Pago y pegalo para hacer la transferencia.',
            );
          } else {
            window.alert(
              '✅ CVU copiado.\nAbrí tu app bancaria o Mercado Pago y pegalo para transferir.',
            );
          }
        })
        .catch(() => window.alert('❌ No se pudo copiar el CVU 😞'));
    },
    [user],
  );

  // Pantalla de carga
  if (loading) {
    return (
      <div className="loading-screen">
        <div className="spinner"></div>
        <p>Cargando...</p>
      </div>
    );
  }

  // Pantalla de login
  if (!user) {
    return (
      <div className="login-screen">
        <div className="login-content">
          <h1>🍽️ Zulmapp</h1>
          <p>Sistema de pedidos de comida</p>
          <p>Iniciá sesión con tu cuenta de Google para hacer tu pedido</p>
          <button className="btn login-btn" onClick={signInWithGoogle}>
            🔐 Iniciar sesión con Google
          </button>
        </div>
      </div>
    );
  }

  // Información de hora actual
  const currentTime = new Date().toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
  });
  const timeAllowed = isAdminUser(user) || isWithinOrderTime();

  // Vista de cocina
  if (currentView === 'cocina') {
    return (
      <div className="container">
        <header className="header">
          <h1>🍽️ Display de Cocina</h1>
          <p>
            {new Date().toLocaleDateString('es-AR', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}{' '}
            - {currentTime}
          </p>
          <div className="kitchen-stats">
            <div>
              <span className="stat-number">{kitchenData.totalDishes}</span>
              <span className="stat-label">Platos</span>
            </div>
            <div>
              <span className="stat-number">{kitchenData.totalPeople}</span>
              <span className="stat-label">Personas</span>
            </div>
          </div>
        </header>
        <div className="kitchen-controls">
          <button className="kitchen-btn" onClick={loadKitchenData}>
            🔄 Actualizar
          </button>
          <button className="kitchen-btn" onClick={copyKitchenList}>
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
          <button className="kitchen-btn secondary" onClick={() => setCurrentView('pedidos')}>
            🔙 Volver
          </button>
        </div>
        {message.text && <div className={`message ${message.type}`}>{message.text}</div>}
        <div className="kitchen-display">
          {kitchenData.dishes.length === 0 ? (
            <div className="no-dishes">
              <div className="empty-icon">🍽️</div>
              <p>No hay platos registrados para hoy</p>
              <p>Última actualización: {currentTime.split(',')[1]}</p>
            </div>
          ) : (
            <ul className="dishes-list">
              {kitchenData.dishes.map((dish, index) => (
                <li key={`${dish.plato}-${dish.nombre}-${index}`} className="dish-item">
                  <div className="dish-number">{index + 1}</div>
                  <div className="dish-details">
                    <span className="dish-name">{dish.plato}</span>
                    <span className="dish-person">{dish.nombre}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // Vista de pedidos
  return (
    <div className="container">
      <header className="header">
        <h1>🍽️ Zulmapp</h1>
      </header>
      <div className="user-info">
        <p>
          👤 Usuario: {user.user_metadata?.name || user.email} ({user.email})
        </p>
        <p>📅 Fecha: {new Date().toLocaleDateString('es-AR')}</p>
        <p>🕐 Hora: {currentTime}</p>
        <button className="btn-link" onClick={signOut}>
          🚪 Cerrar sesión
        </button>
        <button className="btn-link" onClick={() => setCurrentView('cocina')}>
          🍽️ Display de Cocina
        </button>
      </div>
      {isAdminUser(user) ? (
        <div className="admin-mode time-info">
          👑 MODO ADMINISTRADOR - Acceso total sin restricciones
          <br />
          Hora actual: {currentTime}
        </div>
      ) : timeAllowed ? (
        <div className="time-info">
          ✅ App disponible - Podés hacer tu pedido
          <br />
          Hora actual: {currentTime}
        </div>
      ) : (
        <div className="time-restriction">
          ⏰ La app solo está disponible de lunes a viernes de 14:00 a 10:15
          <br />
          Hora actual: {currentTime}
        </div>
      )}
      {message.text && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}
      {currentOrder && (
        <div className="current-order">
          <h3>📋 Tu Pedido Actual</h3>
          <p>👤 Nombre: {currentOrder.nombre}</p>
          <ul className="dish-list">
            {currentOrder.plato1 && <li>{currentOrder.plato1}</li>}
            {currentOrder.plato2 && <li>{currentOrder.plato2}</li>}
          </ul>
          {currentOrder.dishNumbers && currentOrder.dishNumbers.length > 0 && (
            <div className="dish-numbers-info">
              🔢{' '}
              {currentOrder.dishNumbers.length === 1
                ? 'Tu plato en la cocina:'
                : 'Tus platos en la cocina:'}{' '}
              {currentOrder.dishNumbers.length === 1
                ? `Número ${currentOrder.dishNumbers[0]}`
                : `Números ${currentOrder.dishNumbers.join(', ')}`}
            </div>
          )}
          <small>💡 Puedes modificar tu pedido enviando el formulario nuevamente</small>
        </div>
      )}
      {formLoading ? (
        <div className="loading">
          <div className="spinner"></div>
          <p>Procesando pedido...</p>
        </div>
      ) : (
        <form className={timeAllowed ? '' : 'disabled-overlay'} onSubmit={handleSubmit}>
          <div className="form-container">
            <div className="form-group">
              <label>
                👤 Tu Nombre <span>*</span>
              </label>
              <input
                type="text"
                value={formData.nombre}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, nombre: e.target.value }))
                }
                placeholder="Escribe tu nombre completo..."
                required
                disabled={!timeAllowed}
              />
            </div>
            <div className="form-group">
              <label>
                🍽️ Plato Principal <span>*</span>
              </label>
              <select
                value={formData.plato1}
                onChange={(e) => handlePlatoChange(1, e.target.value)}
                required
                disabled={!timeAllowed}
              >
                <option value="">Seleccionar plato...</option>
                {menuItems.map((item, index) => (
                  <option key={`plato1-${index}`} value={item}>
                    {item}
                  </option>
                ))}
                <option value="CUSTOM">📝 Escribir otro plato...</option>
              </select>
              {formData.plato1 === 'CUSTOM' && (
                <input
                  type="text"
                  value={formData.custom1}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, custom1: e.target.value }))
                  }
                  placeholder="Escribe tu plato personalizado..."
                  required
                  disabled={!timeAllowed}
                />
              )}
            </div>
            <div className="form-group">
              <label>🍽️ Segundo Plato (Opcional)</label>
              <select
                value={formData.plato2}
                onChange={(e) => handlePlatoChange(2, e.target.value)}
                disabled={!timeAllowed}
              >
                <option value="">Sin segundo plato</option>
                {menuItems.map((item, index) => (
                  <option key={`plato2-${index}`} value={item}>
                    {item}
                  </option>
                ))}
                <option value="CUSTOM">📝 Escribir otro plato...</option>
              </select>
              {formData.plato2 === 'CUSTOM' && (
                <input
                  type="text"
                  value={formData.custom2}
                  onChange={(e) =>
                    setFormData((prev) => ({ ...prev, custom2: e.target.value }))
                  }
                  placeholder="Escribe tu plato personalizado..."
                  disabled={!timeAllowed}
                />
              )}
            </div>
            <button className="btn" type="submit" disabled={!timeAllowed}>
              {currentOrder ? '✏️ Actualizar Pedido' : '📝 Enviar Pedido'}
            </button>
            {currentOrder && (
              <button
                className="btn cancel-btn"
                type="button"
                onClick={cancelOrder}
                disabled={!timeAllowed}
              >
                🗑️ Cancelar Pedido
              </button>
            )}
          </div>
        </form>
      )}
      <button className="btn transfer-btn" onClick={copiarYActuar}>
        📋 Copiar CVU y continuar
      </button>
      <div className="stats-container">
        <h3 className="stats-title">📊 Estadísticas del Día</h3>
        <p>📊 Total de Pedidos: {stats.totalOrders}</p>
        {Object.keys(stats.menuStats).length > 0 && (
          <div className="stat-item">
            <h4>🏆 Platos Más Pedidos</h4>
            <ul>
              {Object.entries(stats.menuStats)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([dish, count]) => (
                  <li key={dish}>
                    {dish}: {count} pedidos
                  </li>
                ))}
            </ul>
          </div>
        )}
        {stats.peopleList.length > 0 && (
          <div className="stat-item">
            <h4>👥 Personas que han pedido</h4>
            <ul className="people-list">
              {stats.peopleList.map((person, index) => (
                <li key={`person-${index}`} className="people-item">
                  <strong>{person.nombre}</strong> {person.usuario} -{' '}
                  {new Date(person.timestamp).toLocaleTimeString('es-AR', {
                    timeZone: 'America/Argentina/Buenos_Aires',
                    hour12: false
                  })}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
