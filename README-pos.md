# MiniMart POS — Sistema Punto de Venta

Sistema de registro de ventas para MiniMart Express S.A. de C.V.  
Proyecto académico — Equipo 3 · Analítica de Datos · UPIICSA · IPN

---

## Descripción

Aplicación web que funciona como punto de venta para registrar transacciones comerciales directamente en el Data Warehouse (`hechos_ventas`). Diseñada para ser usada por múltiples usuarios simultáneamente a través de una red local o túnel ngrok, generando datos reales que el dashboard de BI puede analizar en tiempo real.

## Funcionalidades

- Catálogo de productos filtrable por categoría y búsqueda
- Selección de cliente desde `dim_cliente`
- Registro de ticket con múltiples productos, cantidades y descuentos
- Cálculo automático de total y margen de ganancia
- Inserción directa en `hechos_ventas` con manejo de transacciones SQL
- Creación automática de entradas en `dim_tiempo` para fechas nuevas
- Historial de ventas registradas con opción de eliminar tickets
- Protección ante condiciones de carrera con `INSERT IGNORE` + clave única en fecha

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js, Express, mysql2 |
| Base de datos | MariaDB (dw_ventas) |
| Frontend | HTML, CSS vanilla |
| Red | ngrok (para acceso remoto) |

## Estructura del proyecto

```
minimart-pos/
├── js/
│   ├── server.js     ← API REST + conexión MariaDB
│   └── pos.js        ← lógica del frontend
├── public/
│   └── index.html    ← interfaz del punto de venta
├── css/
│   └── styles.css    ← estilos tema UPIICSA
├── .env.example      ← plantilla de variables de entorno
└── package.json
```

## Instalación

### Prerrequisitos

- Node.js v18 o superior
- MariaDB con la base de datos `dw_ventas` y las tablas del DWH cargadas
- Haber ejecutado previamente en HeidiSQL:

```sql
USE dw_ventas;
ALTER TABLE dim_tiempo ADD UNIQUE KEY uk_fecha (fecha);
```

### Pasos

1. Clona el repositorio:
```bash
git clone https://github.com/tu-usuario/minimart-pos.git
cd minimart-pos
```

2. Instala las dependencias:
```bash
npm install
```

3. Configura las variables de entorno:
```bash
cp .env.example .env
```
Edita `.env` con tus credenciales de MariaDB.

4. Inicia el servidor:
```bash
npm start
```

5. Abre el navegador en:
```
http://localhost:3031
```

## Uso en red (múltiples usuarios)

Para que tus compañeros puedan registrar ventas desde otras computadoras, usa ngrok:

```bash
npm install -g ngrok
ngrok config add-authtoken TU_TOKEN
ngrok http 3031
```

Comparte la URL generada (ej. `https://abc123.ngrok-free.app`) con tu equipo.  
Todos los datos se acumulan en el mismo MariaDB mientras el servidor esté activo.

## Flujo de datos

```
Formulario POS
    ↓
Validación (cliente y producto existen en dim_cliente y dim_producto)
    ↓
Verificar/crear fecha en dim_tiempo (INSERT IGNORE)
    ↓
INSERT en hechos_ventas (dentro de una transacción SQL)
    ↓
Dashboard BI lo refleja al reiniciar el servidor BI
```

## Equipo

Proyecto desarrollado por el Equipo 3 como parte de la materia de Analítica de Datos en UPIICSA, IPN.
