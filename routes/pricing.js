const express = require('express');
const { settings } = require('../db');
const requireAdmin = require('../middleware/requireAdmin');
const router = express.Router();

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// صفحة الأسعار للمسؤول الكامل فقط
router.use(requireAdmin);

router.get('/', wrap(async (req, res) => {
  const pricing = await settings.getPricing();
  res.render('pricing/index', { pricing });
}));

router.post('/', wrap(async (req, res) => {
  const b = req.body;
  const num = v => {
    const n = parseFloat(v);
    return (isNaN(n) || n < 0) ? 0 : n;
  };
  const floor = k => ({
    inside:  { person: num(b[k + '_in_person']),  kitchen: num(b[k + '_in_kitchen']) },
    outside: { person: num(b[k + '_out_person']), kitchen: num(b[k + '_out_kitchen']) },
  });
  const pricing = {
    retreat: {
      'الدور الأول': floor('f1'),
      'الدور الثاني': floor('f2'),
      'الدور الثالث': floor('f3'),
      'كامل البيت': floor('fh'),
    },
    spiritual_day: { inside: num(b.sd_in), outside: num(b.sd_out) },
  };
  await settings.setPricing(pricing);
  req.flash('success', 'تم حفظ الأسعار الجديدة بنجاح ✅ — الفورمات هتستخدمها فوراً.');
  res.redirect('/pricing');
}));

module.exports = router;
