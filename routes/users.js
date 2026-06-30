const express = require('express');
const bcrypt = require('bcryptjs');
const { users } = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const router = express.Router();

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(requireAdmin);

router.get('/', wrap(async (req, res) => {
  const list = await users.findAll();
  res.render('users/index', { users: list });
}));

router.post('/', wrap(async (req, res) => {
  const { full_name, email, password, role } = req.body;
  const mail = (email || '').trim().toLowerCase();
  try {
    if (!full_name || !mail || !password) throw new Error('الاسم والإيميل وكلمة المرور مطلوبين');
    if (password.length < 6) throw new Error('كلمة المرور لازم تكون 6 حروف على الأقل');
    const exists = await users.findByLogin(mail);
    if (exists) throw new Error('فيه مستخدم بنفس الإيميل بالفعل');
    await users.create({
      username: mail,
      email: mail,
      password_hash: bcrypt.hashSync(password, 10),
      full_name: full_name.trim(),
      role: role === 'admin' ? 'admin' : 'user',
    });
    req.flash('success', `تم إضافة المستخدم: ${full_name}`);
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/users');
}));

router.post('/:id/reset-password', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const { password } = req.body;
  try {
    if (!password || password.length < 6) throw new Error('كلمة المرور لازم تكون 6 حروف على الأقل');
    const u = await users.findById(id);
    if (!u) throw new Error('المستخدم غير موجود');
    await users.setPassword(id, bcrypt.hashSync(password, 10));
    req.flash('success', `تم تغيير كلمة مرور: ${u.full_name}`);
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/users');
}));

router.post('/:id/delete', wrap(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  try {
    if (id === req.session.user.id) throw new Error('مينفعش تحذف حسابك أنت');
    const u = await users.findById(id);
    if (!u) throw new Error('المستخدم غير موجود');
    // منع حذف آخر مسؤول
    if (u.role === 'admin' && (await users.countAdmins()) <= 1) {
      throw new Error('مينفعش تحذف آخر مسؤول في النظام');
    }
    await users.remove(id);
    req.flash('success', `تم حذف المستخدم: ${u.full_name}`);
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/users');
}));

module.exports = router;
