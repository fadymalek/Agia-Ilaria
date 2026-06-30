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
  const user = await users.findByLogin((username || '').trim());

  // حساب مقفول مؤقتاً بسبب محاولات دخول كثيرة
  if (user && user.locked_until && new Date(user.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
    req.flash('error', `الحساب مقفول مؤقتاً بسبب محاولات دخول كثيرة. حاول بعد ${mins} دقيقة.`);
    return res.redirect('/login');
  }

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    if (user) {
      const r = await users.recordFailedLogin(user.id);
      if (r && r.locked_until && new Date(r.locked_until) > new Date()) {
        req.flash('error', 'تم قفل الحساب 15 دقيقة بسبب محاولات الدخول الكثيرة.');
        return res.redirect('/login');
      }
    }
    req.flash('error', 'البريد الإلكتروني/اسم المستخدم أو كلمة المرور غير صحيحة');
    return res.redirect('/login');
  }

  await users.setLastLogin(user.id);
  req.session.user = {
    id: user.id, username: user.username, full_name: user.full_name,
    email: user.email, role: user.role || 'user',
    needsPwChange: !user.pw_changed,
  };
  res.redirect('/bookings');
}));

router.post('/logout', (req, res) => {
  req.session = null;
  res.redirect('/login');
});

module.exports = router;
