const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'data.json');

function load() {
  try {
    if (fs.existsSync(DB_PATH)) {
      return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    }
  } catch (e) { console.error('DB load error:', e.message); }
  return { users: [], bookings: [], nextSeq: 1, nextId: 1 };
}

function save() {
  fs.writeFileSync(DB_PATH, JSON.stringify(_data, null, 2), 'utf8');
}

const _data = load();

if (!_data.users.find(u => u.username === 'admin')) {
  _data.users.push({
    id: 1,
    username: 'admin',
    password_hash: bcrypt.hashSync('admin123', 10),
    full_name: 'المسؤل',
    created_at: new Date().toISOString()
  });
  save();
  console.log('Default admin created: admin / admin123');
}

function generateBookingNumber() {
  const seq = _data.nextSeq++;
  save();
  return `HL-${String(seq).padStart(4, '0')}-${new Date().getFullYear()}`;
}

function nextId() {
  const id = _data.nextId++;
  save();
  return id;
}

const users = {
  findOne: (pred) => _data.users.find(pred) || null,
};

const bookings = {
  findAll: (pred) => pred ? _data.bookings.filter(pred) : [..._data.bookings],
  findById: (id) => _data.bookings.find(b => b.id === id) || null,
  insert: (item) => {
    _data.bookings.push(item);
    save();
    return item;
  },
  update: (id, updates) => {
    const idx = _data.bookings.findIndex(b => b.id === id);
    if (idx >= 0) {
      _data.bookings[idx] = { ..._data.bookings[idx], ...updates };
      save();
      return _data.bookings[idx];
    }
    return null;
  },
  remove: (id) => {
    const idx = _data.bookings.findIndex(b => b.id === id);
    if (idx >= 0) { _data.bookings.splice(idx, 1); save(); return true; }
    return false;
  },
  count: (pred) => pred ? _data.bookings.filter(pred).length : _data.bookings.length,
};

module.exports = { users, bookings, generateBookingNumber, nextId };
