require('dotenv').config();
const mysql = require('mysql2/promise');

const database = String(process.env.DB_NAME || '').trim();
const user = String(process.env.DB_USER || '').trim();
const host = String(process.env.DB_HOST || '').trim();
const password = String(process.env.DB_PASSWORD || '');
if (!/^vivero_lemu_(development|test|validation|production)$/.test(database)) {
  throw new Error('DB_NAME debe identificar una base independiente del Vivero Lemú');
}
if (!user || user.toLowerCase() === 'root') {
  throw new Error('DB_USER debe ser una cuenta exclusiva y de mínimo privilegio; root no está permitido');
}
if (!host || !password) throw new Error('DB_HOST y DB_PASSWORD son obligatorios');

const pool = mysql.createPool({
  host,
  port:               process.env.DB_PORT     || 3306,
  user,
  password,
  database,
  waitForConnections: true,
  connectionLimit:    5,
  queueLimit:         0,
  timezone:           '-03:00',
  charset:            'utf8mb4',
  // Las columnas DATE (fecha_limite, fecha_siembra, fecha_local, etc.) vuelven
  // como string plano 'YYYY-MM-DD' en vez de objeto Date. Sin esto, mysql2
  // devuelve un objeto Date que al pasar por res.json() se serializa como
  // ISO completo ("2026-07-20T00:00:00.000Z"), y el frontend rompe al
  // concatenarle "T00:00:00" (queda "...000ZT00:00:00" → Invalid Date/NaN).
  dateStrings:        ['DATE']
});

pool.getConnection()
  .then(conn => { console.log(`✅ MySQL conectado — ${database}`); conn.release(); })
  .catch(err => { console.error('❌ Error MySQL:', err.message); process.exit(1); });

module.exports = pool;
