// ══════════════════════════════════════════════════════════════════════════════
// pos.js — Frontend del Sistema Punto de Venta MiniMart Express
// ══════════════════════════════════════════════════════════════════════════════

let todosProductos = [];
let categoriaActiva = 'Todos';
let ticketItems     = [];
let productoModal   = null;

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

    // KPIs
    document.getElementById('stat-tickets').textContent   = kpiRes.tickets  || 0;
    document.getElementById('stat-productos').textContent = kpiRes.lineas   || 0;
    document.getElementById('stat-total').textContent     = '$' + fmt(kpiRes.total || 0, 0);
    document.getElementById('total-ventas-badge').textContent = kpiRes.tickets || 0;

    // Lista de tickets recientes
    const lista = document.getElementById('historial-lista');
    lista.innerHTML = '';

    if (!histRes.length) {
      lista.innerHTML = '<div class="ticket-empty">Sin ventas registradas</div>';
      return;
    }

    histRes.forEach(h => {
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
  } catch (e) {
    showToast('Error al cargar historial', true);
  }
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
