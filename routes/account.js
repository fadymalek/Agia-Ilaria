const express = require('express');
const bcrypt = require('bcryptjs');
const { users } = require('../db');
const requireAuth = require('../middleware/requireAuth');
const router = express.Router();

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(requireAuth);

router.get('/', (req, res) => {
  res.render('account/index');
});

router.post('/password', wrap(async (req, res) => {
  const { current_password, new_password, confirm_password } = req.body;
  try {
    const user = await users.findById(req.session.user.id);
    if (!user || !bcrypt.compareSync(current_password || '', user.password_hash)) {
      throw new Error('كلمة المرور الحالية غير صحيحة');
    }
    if (!new_password || new_password.length < 6) {
      throw new Error('كلمة المرور الجديدة لازم تكون 6 حروف على الأقل');
    }
    if (new_password !== confirm_password) {
      throw new Error('تأكيد كلمة المرور غير مطابق');
    }
    await users.changeOwnPassword(user.id, bcrypt.hashSync(new_password, 10));
    req.session.user.needsPwChange = false;
    req.flash('success', 'تم تغيير كلمة المرور بنجاح');
  } catch (e) {
    req.flash('error', e.message);
  }
  res.redirect('/account');
}));

module.exports = router;
