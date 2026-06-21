const express = require('express');
const bcrypt = require('bcryptjs');
const { users } = require('../db');
const router = express.Router();

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/bookings');
  res.redirect('/login');
});

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/bookings');
  res.render('login');
});

router.post('/login', wrap(async (req, res) => {
  const { username, password } = req.body;
  const user = await users.findByUsername(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    req.flash('error', 'اسم المستخدم أو كلمة المرور غير صحيحة');
    return res.redirect('/login');
  }
  req.session.user = { id: user.id, username: user.username, full_name: user.full_name };
  res.redirect('/bookings');
}));

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
