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

// ── POOL DE CONEXIÓN (persistente para todas las operaciones) ─────────────────
const pool = mysql.createPool({
  host:             process.env.DB_HOST,
  port:             process.env.DB_PORT,
  user:             process.env.DB_USER,
  password:         process.env.DB_PASSWORD,
  database:         process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit:  10,
});

// ── CATÁLOGOS EN MEMORIA (solo lectura, se cargan al iniciar) ─────────────────
let CLIENTES  = [];
let PRODUCTOS = [];

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

// ── 3. REGISTRAR VENTA ────────────────────────────────────────────────────────
// Recibe: { cliente_id, fecha, items: [{ producto_id, cantidad, descuento_pct }] }
// Inserta en dim_tiempo (si no existe) y en hechos_ventas
app.post('/api/venta', async (req, res) => {
  const { cliente_id, fecha, items } = req.body;

  if (!cliente_id || !fecha || !items || items.length === 0)
    return res.status(400).json({ error: 'Datos incompletos' });

  const cliente = CLIENTES.find(c => c.cliente_id == cliente_id);
  if (!cliente) return res.status(400).json({ error: 'Cliente no encontrado' });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // Obtener o crear el tiempo_id para la fecha de la venta
    const tiempo_id  = await obtenerTiempoId(fecha);
    const ticket_id  = await siguienteTicketId();
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
    res.json({ ok: true, ticket_id, filas: filasInsertadas });

  } catch (err) {
    await conn.rollback();
    console.error('Error al registrar venta:', err.message);
    res.status(500).json({ error: err.message });
  } finally {
    conn.release();
  }
});

// ── 4. HISTORIAL DE VENTAS RECIENTES ─────────────────────────────────────────
// Devuelve los últimos 50 tickets registrados para mostrar en el panel
app.get('/api/historial', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT
        hv.ticket_id,
        dt.fecha,
        dc.cliente_nombre,
        dc.cliente_localizacion,
        COUNT(hv.producto_id)   AS productos,
        SUM(hv.total_venta)     AS total
      FROM hechos_ventas hv
      JOIN dim_tiempo  dt ON hv.tiempo_id  = dt.tiempo_id
      JOIN dim_cliente dc ON hv.cliente_id = dc.cliente_id
      GROUP BY hv.ticket_id, dt.fecha, dc.cliente_nombre, dc.cliente_localizacion
      ORDER BY hv.ticket_id DESC
      LIMIT 50
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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

// ── INICIAR SERVIDOR ──────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3031;
cargarCatalogos()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`POS corriendo en http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Error al iniciar:', err.message);
    process.exit(1);
  });
