const bcrypt = require('bcryptjs');
const path = require('path');

// اختيار قاعدة البيانات:
//  - إن وُجد DATABASE_URL → Postgres حقيقي (Neon / Render / Vercel) كما هو في الإنتاج.
//  - إن لم يوجد → قاعدة بيانات Postgres مدمجة محلياً (PGlite) للتطوير بدون أي إعداد.
let pool;

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  // Neon / Render / أغلب مزودي Postgres المُدارين يتطلبوا SSL
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false },
  });
} else {
  console.log('\n[i] DATABASE_URL غير موجود — يتم استخدام قاعدة بيانات Postgres مدمجة محلياً (PGlite) للتطوير.\n');
  pool = createLocalPool();
}

// غلاف متوافق مع واجهة pg.Pool فوق PGlite (embedded Postgres) — يوفّر query() مع rowCount.
function createLocalPool() {
  let dbPromise = null;
  function getDb() {
    if (!dbPromise) {
      dbPromise = (async () => {
        const { PGlite } = await import('@electric-sql/pglite');
        const dataDir = process.env.PGLITE_DIR || path.join(__dirname, '.pglite-data');
        return new PGlite(dataDir);
      })();
    }
    return dbPromise;
  }
  return {
    async query(text, params) {
      const db = await getDb();
      const res = await db.query(text, params || []);
      // pg يعيد rowCount؛ PGlite يعيد affectedRows لعمليات DML — نوحّدهما.
      return { rows: res.rows, rowCount: res.affectedRows != null ? res.affectedRows : res.rows.length };
    },
  };
}

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

  // أعمدة إضافية لإدارة المستخدمين (إيميل + صلاحية + آخر دخول + أمان) — إضافة آمنة
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS pw_changed BOOLEAN DEFAULT false`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_attempts INT DEFAULT 0`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ`);
  // أي مستخدم قديم بدون صلاحية يبقى مسؤولاً (المستخدمون الأصليون)
  await pool.query(`UPDATE users SET role = 'admin' WHERE role IS NULL`);

  // سلة المحذوفات: عمود حذف ناعم للحجوزات — لا يُمسح الحجز فعلياً
  await pool.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);

  // جدول إعدادات عامة (منها الأسعار) — إضافة آمنة لا تمس البيانات القديمة
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key        TEXT PRIMARY KEY,
      data       JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

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
  // إعادة تعيين كلمة المرور من المسؤول → يُعتبر مؤقتاً (المستخدم يغيّره)
  async setPassword(id, password_hash) {
    await pool.query(`UPDATE users SET password_hash = $2, pw_changed = false WHERE id = $1`, [id, password_hash]);
  },
  // تغيير المستخدم لكلمة مروره بنفسه
  async changeOwnPassword(id, password_hash) {
    await pool.query(`UPDATE users SET password_hash = $2, pw_changed = true WHERE id = $1`, [id, password_hash]);
  },
  async setLastLogin(id) {
    await pool.query(`UPDATE users SET last_login = now(), failed_attempts = 0, locked_until = NULL WHERE id = $1`, [id]);
  },
  // حماية من محاولات الدخول الكثيرة: قفل 15 دقيقة بعد 5 محاولات فاشلة
  async recordFailedLogin(id) {
    const { rows } = await pool.query(
      `UPDATE users SET failed_attempts = COALESCE(failed_attempts,0) + 1,
         locked_until = CASE WHEN COALESCE(failed_attempts,0) + 1 >= 5 THEN now() + interval '15 minutes' ELSE locked_until END
       WHERE id = $1 RETURNING failed_attempts, locked_until`,
      [id]
    );
    return rows[0];
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
  // الحجوزات النشطة فقط (غير المحذوفة)
  async findAll() {
    const { rows } = await pool.query(
      `SELECT id, booking_number, data FROM bookings WHERE deleted_at IS NULL ORDER BY id ASC`
    );
    return rows.map(rowToBooking);
  },
  async findById(id) {
    const { rows } = await pool.query(
      `SELECT id, booking_number, data FROM bookings WHERE id = $1 AND deleted_at IS NULL`, [id]
    );
    return rowToBooking(rows[0]);
  },
  // المحذوفة (سلة المحذوفات)
  async findDeleted() {
    const { rows } = await pool.query(
      `SELECT id, booking_number, data, deleted_at FROM bookings WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC`
    );
    return rows.map(r => ({ ...rowToBooking(r), deleted_at: r.deleted_at }));
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
      `UPDATE bookings SET data = data || $2::jsonb WHERE id = $1 AND deleted_at IS NULL RETURNING id, booking_number, data`,
      [id, updates]
    );
    return rowToBooking(rows[0]);
  },
  // حذف ناعم → ينقل لسلة المحذوفات
  async softDelete(id) {
    const r = await pool.query(`UPDATE bookings SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return r.rowCount > 0;
  },
  // استرجاع من سلة المحذوفات
  async restore(id) {
    const r = await pool.query(`UPDATE bookings SET deleted_at = NULL WHERE id = $1`, [id]);
    return r.rowCount > 0;
  },
  // حذف نهائي (لا رجعة فيه)
  async purge(id) {
    const r = await pool.query(`DELETE FROM bookings WHERE id = $1 AND deleted_at IS NOT NULL`, [id]);
    return r.rowCount > 0;
  },
};

async function generateBookingNumber() {
  const { rows } = await pool.query(`SELECT nextval('booking_seq') AS seq`);
  const seq = rows[0].seq;
  return `HL-${String(seq).padStart(4, '0')}-${new Date().getFullYear()}`;
}

// ===== الأسعار (قابلة للتعديل من لوحة الإدارة) =====
// الدور الثالث و«كامل البيت» غير مُسعّرين (السعر بالتواصل).
const DEFAULT_PRICING = {
  retreat: {
    'الدور الأول':  { inside: { person: 50,  kitchen: 150 }, outside: { person: 60,  kitchen: 200 } },
    'الدور الثاني': { inside: { person: 100, kitchen: 150 }, outside: { person: 120, kitchen: 200 } },
  },
  spiritual_day: { inside: 60, outside: 70 },
};

const settings = {
  // يرجّع الأسعار المحفوظة، وإن لم توجد يرجّع الافتراضية (فلا يتغيّر السلوك قبل أول تعديل)
  async getPricing() {
    try {
      const { rows } = await pool.query(`SELECT data FROM app_settings WHERE key = 'pricing'`);
      const d = rows[0] && rows[0].data;
      if (d && d.retreat && d.spiritual_day) return d;
    } catch (e) { /* الجدول غير جاهز بعد → استخدم الافتراضي */ }
    return DEFAULT_PRICING;
  },
  async setPricing(data) {
    await pool.query(
      `INSERT INTO app_settings (key, data, updated_at) VALUES ('pricing', $1, now())
       ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
      [data]
    );
  },
};

module.exports = { pool, init, users, bookings, settings, generateBookingNumber, DEFAULT_PRICING };
