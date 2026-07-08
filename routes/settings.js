const express = require('express');
const requireAdmin = require('../middleware/requireAdmin');
const router = express.Router();

// الإعدادات للمسؤول الكامل فقط
router.use(requireAdmin);

// صفحة إعدادات العرض — التفضيلات تُحفظ في متصفح المستخدم (localStorage)
router.get('/', (req, res) => {
  res.render('settings/index');
});

module.exports = router;
