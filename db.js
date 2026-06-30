const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

if (!process.env.DATABASE_URL) {
  console.error('\n[!] DATABASE_URL غير موجود. أضف رابط قاعدة بيانات Postgres في متغيرات البيئة.\n');
}

// Neon / Render / أغلب مزودي Postgres المُدارين يتطلبوا SSL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
});

// تحويل صف قاعدة البيانات لكائن الحجز المسطّح المستخدم في الواجهات
function rowToBooking(row) {
  if (!row) return null;
  return { ...row.data, id: row.id, booking_number: row.booking_number };
}

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            SERIAL PRIMARY KEY,
      username      TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name     TEXT,
      created_at    TIMESTAMPTZ DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id             SERIAL PRIMARY KEY,
      booking_number TEXT UNIQUE NOT NULL,
      data           JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at     TIMESTAMPTZ DEFAULT now()
    );
  `);

  // تسلسل أرقام الحجوزات
  await pool.query(`CREATE SEQUENCE IF NOT EXISTS booking_seq START 1;`);

  // أعمدة إضافية لإدارة المستخدمين (إيميل + صلاحية + آخر دخول) — إضافة آمنة
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ`);
  // أي مستخدم قديم بدون صلاحية يبقى مسؤولاً (المستخدمون الأصليون)
  await pool.query(`UPDATE users SET role = 'admin' WHERE role IS NULL`);

  // إنشاء مستخدم المسؤول الافتراضي إن لم يكن موجوداً
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE username = 'admin'`);
  if (rows.length === 0) {
    await pool.query(
      `INSERT INTO users (username, password_hash, full_name, role) VALUES ($1, $2, $3, 'admin')`,
      ['admin', bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10), 'المسؤل']
    );
    console.log('تم إنشاء مستخدم المسؤول الافتراضي: admin');
  }
}

const users = {
  // الدخول بالإيميل أو اسم المستخدم
  async findByLogin(login) {
    const { rows } = await pool.query(
      `SELECT * FROM users WHERE lower(username) = lower($1) OR lower(email) = lower($1) LIMIT 1`,
      [login]
    );
    return rows[0] || null;
  },
  async findByUsername(username) {
    const { rows } = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
    return rows[0] || null;
  },
  async findById(id) {
    const { rows } = await pool.query(`SELECT * FROM users WHERE id = $1`, [id]);
    return rows[0] || null;
  },
  async findAll() {
    const { rows } = await pool.query(
      `SELECT id, username, email, full_name, role, created_at, last_login FROM users ORDER BY id ASC`
    );
    return rows;
  },
  async create({ username, email, password_hash, full_name, role }) {
    const { rows } = await pool.query(
      `INSERT INTO users (username, email, password_hash, full_name, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, email, full_name, role, created_at`,
      [username, email, password_hash, full_name, role]
    );
    return rows[0];
  },
  async setPassword(id, password_hash) {
    await pool.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [id, password_hash]);
  },
  async setLastLogin(id) {
    await pool.query(`UPDATE users SET last_login = now() WHERE id = $1`, [id]);
  },
  async remove(id) {
    const r = await pool.query(`DELETE FROM users WHERE id = $1`, [id]);
    return r.rowCount > 0;
  },
  async countAdmins() {
    const { rows } = await pool.query(`SELECT count(*) AS c FROM users WHERE role = 'admin'`);
    return parseInt(rows[0].c, 10);
  },
};

const bookings = {
  async findAll() {
    const { rows } = await pool.query(`SELECT id, booking_number, data FROM bookings ORDER BY id ASC`);
    return rows.map(rowToBooking);
  },
  async findById(id) {
    const { rows } = await pool.query(`SELECT id, booking_number, data FROM bookings WHERE id = $1`, [id]);
    return rowToBooking(rows[0]);
  },
  async insert(item) {
    const booking_number = item.booking_number;
    const { rows } = await pool.query(
      `INSERT INTO bookings (booking_number, data) VALUES ($1, $2) RETURNING id, booking_number, data`,
      [booking_number, item]
    );
    return rowToBooking(rows[0]);
  },
  async update(id, updates) {
    // دمج التحديثات داخل حقل JSONB مع الحفاظ على القيم القديمة غير المُرسلة
    const { rows } = await pool.query(
      `UPDATE bookings SET data = data || $2::jsonb WHERE id = $1 RETURNING id, booking_number, data`,
      [id, updates]
    );
    return rowToBooking(rows[0]);
  },
  async remove(id) {
    const r = await pool.query(`DELETE FROM bookings WHERE id = $1`, [id]);
    return r.rowCount > 0;
  },
};

async function generateBookingNumber() {
  const { rows } = await pool.query(`SELECT nextval('booking_seq') AS seq`);
  const seq = rows[0].seq;
  return `HL-${String(seq).padStart(4, '0')}-${new Date().getFullYear()}`;
}

module.exports = { pool, init, users, bookings, generateBookingNumber };
