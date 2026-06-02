// ══════════════════════════════════════════════════════════════════════════════
// server.js — POS MiniMart Express
// Inserta ventas directamente en MariaDB (hechos_ventas + dim_tiempo)
// ══════════════════════════════════════════════════════════════════════════════

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const mysql   = require('mysql2/promise');
const cors    = require('cors');
const path    = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/css', express.static(path.join(__dirname, '..', 'css')));
app.get('/js/pos.js', (req, res) => res.sendFile(path.join(__dirname, 'pos.js')));

// ── POOL DE CONEXIÓN ──────────────────────────────────────────────────────────
const pool = mysql.createPool({
  host:               process.env.DB_HOST,
  port:               process.env.DB_PORT,
  user:               process.env.DB_USER,
  password:           process.env.DB_PASSWORD,
  database:           process.env.DB_NAME,
  ssl: { rejectUnauthorized: false }, // Requerido para Aiven
  waitForConnections: true,
  connectionLimit:    10,
});

// ── CATÁLOGOS EN MEMORIA (solo lectura, se cargan al iniciar) ─────────────────
let CLIENTES  = [];
let PRODUCTOS = [];
let TICKETS_CACHE = []; // Cache de tickets en memoria

async function cargarCatalogos() {
  console.log('Cargando catalogos...');

  const [clientes]  = await pool.query(
    'SELECT cliente_id, cliente_nombre, cliente_edad, cliente_genero, cliente_localizacion FROM dim_cliente ORDER BY cliente_nombre'
  );
  const [productos] = await pool.query(
    'SELECT producto_id, producto_nombre, producto_categoria, producto_precio, producto_costo FROM dim_producto ORDER BY producto_categoria, producto_nombre'
  );

  CLIENTES  = clientes;
  PRODUCTOS = productos;

  console.log(`Listo: ${CLIENTES.length} clientes, ${PRODUCTOS.length} productos`);
}

// ── CARGAR TICKETS EN MEMORIA ────────────────────────────────────────────────
async function cargarTicketsCache() {
  console.log('Cargando tickets en caché...');
  try {
    const [rows] = await pool.query(`
      SELECT
        hv.ticket_id,
        MAX(dt.fecha)             AS fecha,
        dc.cliente_nombre,
        dc.cliente_localizacion,
        COUNT(hv.producto_id)     AS productos,
        SUM(hv.total_venta)       AS total
      FROM hechos_ventas hv
      LEFT JOIN dim_tiempo  dt ON hv.tiempo_id  = dt.tiempo_id
      LEFT JOIN dim_cliente dc ON hv.cliente_id = dc.cliente_id
      GROUP BY hv.ticket_id, dc.cliente_nombre, dc.cliente_localizacion
      ORDER BY hv.ticket_id DESC
    `);
    TICKETS_CACHE = rows;
    console.log(`Caché listo: ${TICKETS_CACHE.length} tickets`);
  } catch (err) {
    console.error('Error cargando caché:', err.message);
  }
}

// ── AGREGAR TICKET AL CACHÉ EN MEMORIA ───────────────────────────────────────
function agregarTicketCache(ticket_id, fecha, cliente, productos, total) {
  TICKETS_CACHE.unshift({
    ticket_id,
    fecha,
    cliente_nombre: cliente.cliente_nombre,
    cliente_localizacion: cliente.cliente_localizacion,
    productos,
    total
  });
}

// ── HELPER: obtener o crear entrada en dim_tiempo ─────────────────────────────
// Usa INSERT IGNORE para evitar duplicados en caso de que dos usuarios
// intenten registrar la misma fecha simultáneamente (race condition).
// IMPORTANTE: ejecutar antes en HeidiSQL:
//   ALTER TABLE dim_tiempo ADD UNIQUE KEY uk_fecha (fecha);
async function obtenerTiempoId(fecha) {
  const d         = new Date(fecha);
  const dias      = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const festivos  = ['01-01','02-05','03-18','05-01','09-16','11-02','12-25'];
  const mesDia    = String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  const mes        = d.getMonth() + 1;
  const año        = d.getFullYear();
  const dia_semana = dias[d.getDay()];
  const dia_festivo = festivos.includes(mesDia) ? 1 : 0;

  // Verificar si ya existe esta fecha en caché
  const [existente] = await pool.query(
    'SELECT tiempo_id FROM dim_tiempo WHERE fecha = ?', [fecha]
  );
  if (existente.length > 0) return existente[0].tiempo_id;

  // No existe — calcular siguiente ID y usar INSERT IGNORE
  // Si dos usuarios llegan al mismo tiempo, uno inserta y el otro
  // simplemente ignora el error y luego hace SELECT para obtener el ID
  const [maxId]  = await pool.query('SELECT MAX(tiempo_id) AS max_id FROM dim_tiempo');
  const nuevoId  = (Number(maxId[0].max_id) || 0) + 1;

  await pool.query(
    'INSERT IGNORE INTO dim_tiempo (tiempo_id, fecha, mes, `año`, dia_semana, dia_festivo) VALUES (?, ?, ?, ?, ?, ?)',
    [nuevoId, fecha, mes, año, dia_semana, dia_festivo]
  );

  // Obtener el tiempo_id real (por si ya lo insertó otro usuario antes)
  const [resultado] = await pool.query(
    'SELECT tiempo_id FROM dim_tiempo WHERE fecha = ?', [fecha]
  );
  return resultado[0].tiempo_id;
}

// ── HELPER: siguiente ticket_id disponible ────────────────────────────────────
async function siguienteTicketId() {
  const [rows] = await pool.query('SELECT MAX(ticket_id) AS max_id FROM hechos_ventas');
  return (Number(rows[0].max_id) || 0) + 1;
}

// ══════════════════════════════════════════════════════════════════════════════
// ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════════

// ── 1. CATÁLOGO DE CLIENTES ───────────────────────────────────────────────────
app.get('/api/clientes', (req, res) => res.json(CLIENTES));

// ── 2. CATÁLOGO DE PRODUCTOS ──────────────────────────────────────────────────
app.get('/api/productos', (req, res) => res.json(PRODUCTOS));

// Catalogo completo con IDs (para gestion)
app.get('/api/productos-completo', (req, res) => res.json(PRODUCTOS));

// ── 3. REGISTRAR VENTA ────────────────────────────────────────────────────────
// Recibe: { cliente_id, fecha, items: [{ producto_id, cantidad, descuento_pct }] }
// Inserta en dim_tiempo (si no existe) y en hechos_ventas
app.post('/api/venta', async (req, res) => {
  const { cliente_id, fecha, items, ticket_id_manual } = req.body;

  if (!cliente_id || !fecha || !items || items.length === 0)
    return res.status(400).json({ error: 'Datos incompletos' });

  const cliente = CLIENTES.find(c => c.cliente_id == cliente_id);
  if (!cliente) return res.status(400).json({ error: 'Cliente no encontrado' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const tiempo_id = await obtenerTiempoId(fecha);
    
    // Usar ticket_id manual si se proporcionó, si no generar automático
    const ticket_id = ticket_id_manual ? Number(ticket_id_manual) : await siguienteTicketId();

    // Verificar que el ticket_id no exista ya
    if (ticket_id_manual) {
      const [existe] = await conn.query(
        'SELECT ticket_id FROM hechos_ventas WHERE ticket_id = ? LIMIT 1', [ticket_id]
      );
      if (existe.length > 0) {
        await conn.rollback();
        conn.release();
        return res.status(409).json({ error: `El ticket #${ticket_id} ya existe. Usa otro número.` });
      }
    }

    let filasInsertadas = 0;

    for (const item of items) {
      const producto = PRODUCTOS.find(p => p.producto_id == item.producto_id);
      if (!producto) continue;

      const cantidad    = Number(item.cantidad) || 1;
      const descuento   = Number(item.descuento_pct) || 0;
      const total_venta = Number((producto.producto_precio * cantidad * (1 - descuento / 100)).toFixed(2));
      const margen      = Number(((producto.producto_precio - producto.producto_costo) * cantidad * (1 - descuento / 100)).toFixed(2));

      await conn.query(
        `INSERT INTO hechos_ventas
         (ticket_id, tiempo_id, cliente_id, producto_id, cantidad, descuento_pct, total_venta, margen_ganancia)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [ticket_id, tiempo_id, cliente_id, producto.producto_id, cantidad, descuento, total_venta, margen]
      );
      filasInsertadas++;
    }

    await conn.commit();

    // Actualizar caché en memoria sin recargar toda la BD
    agregarTicketCache(ticket_id, fecha, cliente, filasInsertadas,
      items.reduce((sum, item) => {
        const p = PRODUCTOS.find(p => p.producto_id == item.producto_id);
        if (!p) return sum;
        const cant = Number(item.cantidad) || 1;
        const desc = Number(item.descuento_pct) || 0;
        return sum + p.producto_precio * cant * (1 - desc / 100);
      }, 0)
    );

    res.json({ ok: true, ticket_id, filas: filasInsertadas });

  } catch (err) {
    await conn.rollback();
    console.error('Error al registrar venta:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── 4. BÚSQUEDA DE TICKET EN MEMORIA ─────────────────────────────────────────
app.get('/api/buscar-ticket/:ticket_id', (req, res) => {
  const ticketId = Number(req.params.ticket_id);
  if (!ticketId) return res.json([]);
  const resultado = TICKETS_CACHE.filter(t => t.ticket_id === ticketId);
  res.json(resultado);
});

// ── 5. HISTORIAL DE VENTAS (CACHÉ - OPCIONAL) ─────────────────────────────────
// Devuelve resumen desde caché en memoria
app.get('/api/historial', (req, res) => {
  res.json(TICKETS_CACHE);
});

// ── 5. ELIMINAR TICKET ────────────────────────────────────────────────────────
app.delete('/api/venta/:ticket_id', async (req, res) => {
  const id = Number(req.params.ticket_id);
  try {
    const [result] = await pool.query(
      'DELETE FROM hechos_ventas WHERE ticket_id = ?', [id]
    );
    res.json({ eliminadas: result.affectedRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 6. KPIs DE LA SESIÓN ──────────────────────────────────────────────────────
app.get('/api/kpis-sesion', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        COUNT(DISTINCT ticket_id) AS tickets,
        COUNT(*)                  AS lineas,
        SUM(total_venta)          AS total
      FROM hechos_ventas
    `);
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// ── GESTIÓN DE CLIENTES ───────────────────────────────────────────────────────

// Agregar nuevo cliente
app.post('/api/clientes', async (req, res) => {
  const { cliente_nombre, cliente_edad, cliente_genero, cliente_localizacion } = req.body;
  if (!cliente_nombre || !cliente_localizacion)
    return res.status(400).json({ error: 'Nombre y localización son obligatorios' });
  try {
    const [maxId] = await pool.query('SELECT MAX(cliente_id) AS max_id FROM dim_cliente');
    const nuevoId = (Number(maxId[0].max_id) || 0) + 1;
    await pool.query(
      'INSERT INTO dim_cliente (cliente_id, cliente_nombre, cliente_edad, cliente_genero, cliente_localizacion) VALUES (?, ?, ?, ?, ?)',
      [nuevoId, cliente_nombre, cliente_edad || 0, cliente_genero || 'M', cliente_localizacion]
    );
    // Recargar catálogo en memoria
    const [rows] = await pool.query('SELECT cliente_id, cliente_nombre, cliente_edad, cliente_genero, cliente_localizacion FROM dim_cliente ORDER BY cliente_nombre');
    CLIENTES = rows;
    res.json({ ok: true, cliente_id: nuevoId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar cliente
app.delete('/api/clientes/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    await pool.query('DELETE FROM dim_cliente WHERE cliente_id = ?', [id]);
    CLIENTES = CLIENTES.filter(c => c.cliente_id !== id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GESTIÓN DE PRODUCTOS ──────────────────────────────────────────────────────

// Agregar nuevo producto
app.post('/api/productos', async (req, res) => {
  const { producto_nombre, producto_categoria, producto_precio, producto_costo } = req.body;
  if (!producto_nombre || !producto_categoria || !producto_precio || !producto_costo)
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  try {
    const [maxId] = await pool.query('SELECT MAX(producto_id) AS max_id FROM dim_producto');
    const nuevoId = (Number(maxId[0].max_id) || 0) + 1;
    await pool.query(
      'INSERT INTO dim_producto (producto_id, producto_nombre, producto_categoria, producto_precio, producto_costo) VALUES (?, ?, ?, ?, ?)',
      [nuevoId, producto_nombre, producto_categoria, Number(producto_precio), Number(producto_costo)]
    );
    const [rows] = await pool.query('SELECT producto_id, producto_nombre, producto_categoria, producto_precio, producto_costo FROM dim_producto ORDER BY producto_categoria, producto_nombre');
    PRODUCTOS = rows;
    res.json({ ok: true, producto_id: nuevoId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar producto
app.delete('/api/productos/:id', async (req, res) => {
  const id = Number(req.params.id);
  try {
    await pool.query('DELETE FROM dim_producto WHERE producto_id = ?', [id]);
    PRODUCTOS = PRODUCTOS.filter(p => p.producto_id !== id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── INICIAR SERVIDOR ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3031;
Promise.all([cargarCatalogos(), cargarTicketsCache()])
  .then(() => {
    app.listen(PORT, () => {
      console.log(`POS corriendo en http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Error al iniciar:', err.message);
    process.exit(1);
  });
