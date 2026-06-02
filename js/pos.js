// ══════════════════════════════════════════════════════════════════════════════
// pos.js — Frontend del Sistema Punto de Venta MiniMart Express
// ══════════════════════════════════════════════════════════════════════════════

let todosProductos = [];
let categoriaActiva = 'Todos';
let ticketItems     = [];
let productoModal   = null;
let historialCompleto = []; // Variable para guardar todos los tickets

// ── INICIALIZACIÓN ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const hoy = new Date();
  document.getElementById('fecha-actual').textContent =
    hoy.toLocaleDateString('es-MX', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  document.getElementById('fecha-venta').value = hoy.toISOString().slice(0, 10);

  await Promise.all([cargarClientes(), cargarProductos()]);
  await cargarHistorial();

  document.getElementById('modal-cantidad').addEventListener('input', actualizarPreviewModal);
  document.getElementById('modal-descuento').addEventListener('change', actualizarPreviewModal);
});

// ── CARGAR CLIENTES ───────────────────────────────────────────────────────────
async function cargarClientes() {
  const res      = await fetch('/api/clientes');
  const clientes = await res.json();
  const sel      = document.getElementById('select-cliente');
  clientes.forEach(c => {
    const op = document.createElement('option');
    op.value       = c.cliente_id;
    op.textContent = `${c.cliente_nombre} — ${c.cliente_localizacion}`;
    sel.appendChild(op);
  });
}

// ── CARGAR PRODUCTOS ──────────────────────────────────────────────────────────
async function cargarProductos() {
  const res      = await fetch('/api/productos');
  todosProductos = await res.json();

  const categorias = ['Todos', ...new Set(todosProductos.map(p => p.producto_categoria))];
  const tabsEl     = document.getElementById('categoria-tabs');
  categorias.forEach(cat => {
    const btn       = document.createElement('button');
    btn.className   = 'cat-tab' + (cat === 'Todos' ? ' active' : '');
    btn.textContent = cat;
    btn.onclick     = () => seleccionarCategoria(cat, btn);
    tabsEl.appendChild(btn);
  });
  renderProductos();
}

// ── RENDERIZAR PRODUCTOS ──────────────────────────────────────────────────────
function renderProductos() {
  const busqueda = document.getElementById('buscar-producto').value.toLowerCase();
  const lista    = document.getElementById('producto-lista');
  lista.innerHTML = '';

  const filtrados = todosProductos.filter(p => {
    const matchCat  = categoriaActiva === 'Todos' || p.producto_categoria === categoriaActiva;
    const matchBusc = p.producto_nombre.toLowerCase().includes(busqueda);
    return matchCat && matchBusc;
  });

  if (filtrados.length === 0) {
    lista.innerHTML = '<div class="ticket-empty">Sin productos encontrados</div>';
    return;
  }

  filtrados.forEach(p => {
    const card     = document.createElement('div');
    card.className = 'producto-card';
    card.innerHTML = `
      <div class="producto-info">
        <div class="prod-nombre">${p.producto_nombre}</div>
        <div class="prod-cat">${p.producto_categoria}</div>
      </div>
      <div class="prod-precio">$${fmt(p.producto_precio, 0)}</div>
    `;
    card.onclick = () => abrirModal(p);
    lista.appendChild(card);
  });
}

function filtrarProductos() { renderProductos(); }

function seleccionarCategoria(cat, btn) {
  categoriaActiva = cat;
  document.querySelectorAll('.cat-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderProductos();
}

// ── MODAL ─────────────────────────────────────────────────────────────────────
function abrirModal(producto) {
  productoModal = producto;
  document.getElementById('modal-producto-nombre').textContent = producto.producto_nombre;
  document.getElementById('modal-producto-precio').textContent = `Precio unitario: $${fmt(producto.producto_precio, 2)}`;
  document.getElementById('modal-cantidad').value  = 1;
  document.getElementById('modal-descuento').value = 0;
  actualizarPreviewModal();
  document.getElementById('modal').classList.add('active');
}

function actualizarPreviewModal() {
  if (!productoModal) return;
  const cant  = Number(document.getElementById('modal-cantidad').value) || 1;
  const desc  = Number(document.getElementById('modal-descuento').value) || 0;
  const total = productoModal.producto_precio * cant * (1 - desc / 100);
  document.getElementById('modal-total-preview').textContent = `Total: $${fmt(total, 2)}`;
}

function cerrarModal(event) {
  if (event && event.target !== document.getElementById('modal')) return;
  document.getElementById('modal').classList.remove('active');
  productoModal = null;
}

// ── AGREGAR AL TICKET ─────────────────────────────────────────────────────────
function agregarAlTicket() {
  if (!productoModal) return;
  const cantidad  = Number(document.getElementById('modal-cantidad').value) || 1;
  const descuento = Number(document.getElementById('modal-descuento').value) || 0;
  const total     = productoModal.producto_precio * cantidad * (1 - descuento / 100);

  const existente = ticketItems.find(i => i.producto_id === productoModal.producto_id && i.descuento_pct === descuento);
  if (existente) {
    existente.cantidad   += cantidad;
    existente.total_venta = productoModal.producto_precio * existente.cantidad * (1 - descuento / 100);
  } else {
    ticketItems.push({
      producto_id:        productoModal.producto_id,
      producto_nombre:    productoModal.producto_nombre,
      producto_precio:    productoModal.producto_precio,
      producto_costo:     productoModal.producto_costo,
      cantidad,
      descuento_pct:      descuento,
      total_venta:        total,
    });
  }

  document.getElementById('modal').classList.remove('active');
  productoModal = null;
  renderTicket();
}

// ── RENDERIZAR TICKET ─────────────────────────────────────────────────────────
function renderTicket() {
  const contenedor = document.getElementById('ticket-items');
  contenedor.innerHTML = '';

  if (ticketItems.length === 0) {
    contenedor.innerHTML = '<div class="ticket-empty">Agrega productos desde el catalogo</div>';
    document.getElementById('subtotal').textContent    = '$0.00';
    document.getElementById('total-final').textContent = '$0.00';
    return;
  }

  let total = 0;
  ticketItems.forEach((item, idx) => {
    total += item.total_venta;
    const el     = document.createElement('div');
    el.className = 'ticket-item';
    el.innerHTML = `
      <div style="flex:1">
        <div class="item-nombre">${item.producto_nombre}</div>
        <div class="item-detalle">${item.cantidad} u. x $${fmt(item.producto_precio, 2)}${item.descuento_pct > 0 ? ` — ${item.descuento_pct}% dto.` : ''}</div>
      </div>
      <div class="item-precio">$${fmt(item.total_venta, 2)}</div>
      <button class="item-quitar" onclick="quitarItem(${idx})">x</button>
    `;
    contenedor.appendChild(el);
  });

  document.getElementById('subtotal').textContent    = `$${fmt(total, 2)}`;
  document.getElementById('total-final').textContent = `$${fmt(total, 2)}`;
}

function quitarItem(idx) { ticketItems.splice(idx, 1); renderTicket(); }
function cancelarTicket() { ticketItems = []; renderTicket(); }

// ── REGISTRAR VENTA EN MARIADB ────────────────────────────────────────────────
async function registrarVenta() {
  const cliente_id = document.getElementById('select-cliente').value;
  const fecha      = document.getElementById('fecha-venta').value;

  if (!cliente_id)           { showToast('Selecciona un cliente', true); return; }
  if (!fecha)                { showToast('Selecciona la fecha', true); return; }
  if (ticketItems.length === 0) { showToast('Agrega al menos un producto', true); return; }

  try {
    const res  = await fetch('/api/venta', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cliente_id, fecha, items: ticketItems }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    ticketItems = [];
    renderTicket();
    await cargarHistorial();
    showToast(`Venta #${data.ticket_id} registrada en MariaDB`);

  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

// ── HISTORIAL DESDE MARIADB ───────────────────────────────────────────────────
async function cargarHistorial() {
  try {
    const [histRes, kpiRes] = await Promise.all([
      fetch('/api/historial').then(r => r.json()),
      fetch('/api/kpis-sesion').then(r => r.json()),
    ]);

    // Guardar historial completo en variable global PRIMERO
    historialCompleto = histRes || [];

    // KPIs
    document.getElementById('stat-tickets').textContent   = kpiRes.tickets  || 0;
    document.getElementById('stat-productos').textContent = kpiRes.lineas   || 0;
    document.getElementById('stat-total').textContent     = '$' + fmt(kpiRes.total || 0, 0);
    document.getElementById('total-ventas-badge').textContent = kpiRes.tickets || 0;

    // Cargar ciudades en el select
    cargarCiudades();

    // Renderizar primero
    renderHistorial(historialCompleto);
    
    // Limpiar input después (con delay para evitar race condition)
    setTimeout(() => {
      document.getElementById('buscar-ticket').value = '';
    }, 100);

  } catch (e) {
    showToast('Error al cargar historial', true);
  }
}

// ── CARGAR CIUDADES EN SELECT ────────────────────────────────────────────────
function cargarCiudades() {
  const ciudades = [...new Set(historialCompleto.map(h => h.cliente_localizacion))].sort();
  const select = document.getElementById('filtro-ciudad');
  
  // Guardar la opción "Todas" y agregar ciudades
  const opcionTodas = select.querySelector('option[value=""]');
  ciudades.forEach(ciudad => {
    const option = document.createElement('option');
    option.value = ciudad;
    option.textContent = ciudad;
    select.appendChild(option);
  });
}

// ── APLICAR FILTROS (CIUDAD + BÚSQUEDA) ──────────────────────────────────────
function aplicarFiltros() {
  const ciudad = document.getElementById('filtro-ciudad').value;
  const busqueda = document.getElementById('buscar-ticket').value.trim();
  
  // Filtrar por ciudad primero
  let filtrados = ciudad 
    ? historialCompleto.filter(h => h.cliente_localizacion === ciudad)
    : historialCompleto;
  
  // Luego filtrar por ticket si hay búsqueda
  if (busqueda) {
    filtrados = filtrados.filter(h => {
      const ticketStr = String(h.ticket_id).trim();
      return ticketStr === busqueda;
    });
  }
  
  renderHistorial(filtrados);
}

// ── RENDERIZAR HISTORIAL CON FILTRADO ──────────────────────────────────────
function renderHistorial(tickets) {
  const lista = document.getElementById('historial-lista');
  lista.innerHTML = '';

  if (!tickets.length) {
    lista.innerHTML = '<div class="ticket-empty">Sin ventas registradas</div>';
    return;
  }

  tickets.forEach(h => {
    const el     = document.createElement('div');
    el.className = 'historial-item';
    el.innerHTML = `
      <div class="hist-info">
        <div class="hist-ticket">Ticket #${h.ticket_id} — ${h.fecha ? String(h.fecha).slice(0,10) : ''}</div>
        <div class="hist-detalle">${h.cliente_nombre} · ${h.productos} producto(s)</div>
      </div>
      <div style="display:flex; gap:10px; align-items:center">
        <div class="hist-total">$${fmt(h.total, 0)}</div>
        <button class="hist-quitar" onclick="eliminarTicket(${h.ticket_id})">x</button>
      </div>
    `;
    lista.appendChild(el);
  });
}

// ── ELIMINAR TICKET ───────────────────────────────────────────────────────────
async function eliminarTicket(ticket_id) {
  if (!confirm(`Eliminar ticket #${ticket_id} de la base de datos?`)) return;
  try {
    await fetch(`/api/venta/${ticket_id}`, { method: 'DELETE' });
    await cargarHistorial();
    showToast(`Ticket #${ticket_id} eliminado`);
  } catch (e) {
    showToast('Error al eliminar', true);
  }
}

// ── FILTRAR HISTORIAL POR BÚSQUEDA ────────────────────────────────────────────
function filtrarHistorial() {
  const busqueda = document.getElementById('buscar-ticket').value.trim();
  
  console.log('filtrarHistorial: busqueda=', busqueda, 'historialCompleto.length=', historialCompleto.length);
  
  if (!busqueda) {
    renderHistorial(historialCompleto);
    return;
  }

  const filtrados = historialCompleto.filter(h => {
    const ticketStr = String(h.ticket_id).trim();
    return ticketStr === busqueda;
  });

  console.log('Encontrados:', filtrados.length);
  renderHistorial(filtrados);
}

// ── IMPRIMIR TICKETS VISIBLES ──────────────────────────────────────────────────
function imprimirTickets() {
  // Obtener tickets actualmente visibles
  const items = document.querySelectorAll('.historial-item');
  
  if (items.length === 0) {
    showToast('No hay tickets para imprimir', true);
    return;
  }

  // Crear ventana de impresión
  const printWindow = window.open('', '', 'width=800,height=600');
  
  let html = `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Impresión de Tickets - MiniMart POS</title>
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: Arial, sans-serif; 
          background: #fff; 
          color: #333;
          padding: 20px;
        }
        .header {
          text-align: center;
          border-bottom: 2px solid #333;
          padding-bottom: 15px;
          margin-bottom: 20px;
        }
        .header h1 {
          font-size: 24px;
          margin-bottom: 5px;
        }
        .header p {
          font-size: 12px;
          color: #666;
        }
        .ticket-section {
          margin-bottom: 20px;
          page-break-inside: avoid;
        }
        .ticket-titulo {
          background: #f0f0f0;
          padding: 8px 12px;
          font-weight: bold;
          border-left: 4px solid #00a651;
          margin-bottom: 8px;
        }
        .ticket-content {
          padding: 0 12px;
          font-size: 12px;
          line-height: 1.6;
        }
        .ticket-row {
          display: flex;
          justify-content: space-between;
          padding: 4px 0;
          border-bottom: 1px solid #eee;
        }
        .ticket-row.total {
          font-weight: bold;
          font-size: 13px;
          border-bottom: 2px solid #333;
          padding: 8px 0;
        }
        .footer {
          text-align: center;
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #ccc;
          font-size: 11px;
          color: #999;
        }
        @media print {
          body { padding: 0; }
          .header { border-bottom: 1px solid #000; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>MiniMart POS</h1>
        <p>Reporte de Tickets - ${new Date().toLocaleString('es-MX')}</p>
      </div>

      <div class="content">
  `;

  // Agregar cada ticket
  let totalGeneral = 0;
  items.forEach(item => {
    const ticket = item.querySelector('.hist-ticket')?.textContent || '';
    const detalle = item.querySelector('.hist-detalle')?.textContent || '';
    const total = item.querySelector('.hist-total')?.textContent || '$0.00';
    
    // Extraer valor numérico del total
    const totalNumerico = parseFloat(total.replace(/[^0-9.-]/g, ''));
    totalGeneral += totalNumerico;

    html += `
      <div class="ticket-section">
        <div class="ticket-titulo">${ticket}</div>
        <div class="ticket-content">
          <div class="ticket-row">
            <span>${detalle}</span>
          </div>
          <div class="ticket-row total">
            <span>Total:</span>
            <span>${total}</span>
          </div>
        </div>
      </div>
    `;
  });

  html += `
      </div>
      
      <div class="footer">
        <p><strong>Total General: $${fmt(totalGeneral, 2)}</strong></p>
        <p>Cantidad de tickets: ${items.length}</p>
        <p>Impreso: ${new Date().toLocaleString('es-MX')}</p>
      </div>
    </body>
    </html>
  `;

  printWindow.document.write(html);
  printWindow.document.close();

  // Esperar a que cargue y luego imprimir
  setTimeout(() => {
    printWindow.print();
    printWindow.close();
  }, 250);

  showToast(`${items.length} ticket(s) listos para imprimir`);
}

// ── UTILIDADES ────────────────────────────────────────────────────────────────
function fmt(n, dec = 2) {
  return Number(n).toLocaleString('es-MX', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function showToast(msg, error = false) {
  const t   = document.getElementById('toast');
  t.textContent = msg;
  t.className   = 'toast show' + (error ? ' error' : '');
  setTimeout(() => { t.className = 'toast'; }, 3000);
}

// ══════════════════════════════════════════════════════════════════════════════
// GESTIÓN DE CATÁLOGOS — Pestaña "Catalogo"
// ══════════════════════════════════════════════════════════════════════════════

// ── CAMBIAR ENTRE PESTAÑAS ────────────────────────────────────────────────────
function cambiarTab(tab, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  const posView = document.querySelector('.pos-grid');
  const catView = document.getElementById('vista-catalogos');

  if (tab === 'ventas') {
    posView.style.display = 'grid';
    catView.style.display = 'none';
  } else {
    posView.style.display = 'none';
    catView.style.display = 'block';
    renderListaClientes();
    renderListaProductos();
  }
}

// ── RENDERIZAR LISTA DE CLIENTES ──────────────────────────────────────────────
async function renderListaClientes() {
  const res      = await fetch('/api/clientes');
  const clientes = await res.json();
  const lista    = document.getElementById('lista-clientes');
  lista.innerHTML = '';

  clientes.forEach(c => {
    const el     = document.createElement('div');
    el.className = 'catalogo-item';
    el.innerHTML = `
      <div class="catalogo-item-info">
        <div class="ci-nombre">${c.cliente_nombre}</div>
        <div class="ci-detalle">${c.cliente_localizacion} · ${c.cliente_genero} · ${c.cliente_edad} años</div>
      </div>
      <button class="btn-eliminar" onclick="eliminarCliente(${c.cliente_id}, '${c.cliente_nombre}')">Eliminar</button>
    `;
    lista.appendChild(el);
  });
}

// ── RENDERIZAR LISTA DE PRODUCTOS ─────────────────────────────────────────────
async function renderListaProductos() {
  const res      = await fetch('/api/productos-completo');
  const productos = await res.json();
  const lista    = document.getElementById('lista-productos');
  lista.innerHTML = '';

  productos.forEach(p => {
    const el     = document.createElement('div');
    el.className = 'catalogo-item';
    el.innerHTML = `
      <div class="catalogo-item-info">
        <div class="ci-nombre">${p.producto_nombre}</div>
        <div class="ci-detalle">${p.producto_categoria} · Costo: $${p.producto_costo}</div>
      </div>
      <div style="display:flex; gap:10px; align-items:center">
        <div class="ci-precio">$${p.producto_precio}</div>
        <button class="btn-eliminar" onclick="eliminarProducto(${p.producto_id}, '${p.producto_nombre}')">Eliminar</button>
      </div>
    `;
    lista.appendChild(el);
  });
}

// ── AGREGAR CLIENTE ───────────────────────────────────────────────────────────
async function agregarCliente() {
  const nombre = document.getElementById('cli-nombre').value.trim();
  const edad   = document.getElementById('cli-edad').value;
  const genero = document.getElementById('cli-genero').value;
  const ciudad = document.getElementById('cli-ciudad').value;

  if (!nombre || !ciudad) { showToast('Nombre y ciudad son obligatorios', true); return; }

  try {
    const res  = await fetch('/api/clientes', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ cliente_nombre: nombre, cliente_edad: edad, cliente_genero: genero, cliente_localizacion: ciudad }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    document.getElementById('cli-nombre').value = '';
    document.getElementById('cli-ciudad').value = ''; // Reset select a opción vacía
    document.getElementById('cli-edad').value   = '30';
    await renderListaClientes();
    // Recargar select de clientes en el POS
    await recargarSelectClientes();
    showToast(`Cliente agregado (ID: ${data.cliente_id})`);
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

// ── AGREGAR PRODUCTO ──────────────────────────────────────────────────────────
async function agregarProducto() {
  const nombre    = document.getElementById('prod-nombre').value.trim();
  const categoria = document.getElementById('prod-categoria').value;
  const precio    = document.getElementById('prod-precio').value;
  const costo     = document.getElementById('prod-costo').value;

  if (!nombre || !precio || !costo) { showToast('Todos los campos son obligatorios', true); return; }
  if (Number(costo) >= Number(precio)) { showToast('El costo debe ser menor que el precio', true); return; }

  try {
    const res  = await fetch('/api/productos', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ producto_nombre: nombre, producto_categoria: categoria, producto_precio: precio, producto_costo: costo }),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);

    document.getElementById('prod-nombre').value = '';
    document.getElementById('prod-precio').value = '';
    document.getElementById('prod-costo').value  = '';
    await renderListaProductos();
    // Recargar catálogo de productos en el POS
    const prodRes = await fetch('/api/productos');
    todosProductos = await prodRes.json();
    renderProductos();
    showToast(`Producto agregado (ID: ${data.producto_id})`);
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

// ── ELIMINAR CLIENTE ──────────────────────────────────────────────────────────
async function eliminarCliente(id, nombre) {
  if (!confirm(`Eliminar a ${nombre}?`)) return;
  try {
    await fetch(`/api/clientes/${id}`, { method: 'DELETE' });
    await renderListaClientes();
    await recargarSelectClientes();
    showToast(`Cliente eliminado`);
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

// ── ELIMINAR PRODUCTO ─────────────────────────────────────────────────────────
async function eliminarProducto(id, nombre) {
  if (!confirm(`Eliminar "${nombre}"?`)) return;
  try {
    await fetch(`/api/productos/${id}`, { method: 'DELETE' });
    await renderListaProductos();
    const prodRes = await fetch('/api/productos');
    todosProductos = await prodRes.json();
    renderProductos();
    showToast(`Producto eliminado`);
  } catch (e) {
    showToast('Error: ' + e.message, true);
  }
}

// ── RECARGAR SELECT DE CLIENTES EN EL POS ────────────────────────────────────
async function recargarSelectClientes() {
  const res      = await fetch('/api/clientes');
  const clientes = await res.json();
  const sel      = document.getElementById('select-cliente');
  const valorActual = sel.value;
  sel.innerHTML  = '<option value="">-- Seleccionar cliente --</option>';
  clientes.forEach(c => {
    const op       = document.createElement('option');
    op.value       = c.cliente_id;
    op.textContent = `${c.cliente_nombre} — ${c.cliente_localizacion}`;
    sel.appendChild(op);
  });
  sel.value = valorActual;
}
