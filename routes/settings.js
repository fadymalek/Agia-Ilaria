const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const router = express.Router();

router.use(requireAuth);

// صفحة إعدادات العرض — التفضيلات تُحفظ في متصفح المستخدم (localStorage)
router.get('/', (req, res) => {
  res.render('settings/index');
});

module.exports = router;
