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
  const pricing = {
    retreat: {
      'الدور الأول': {
        inside:  { person: num(b.f1_in_person),  kitchen: num(b.f1_in_kitchen) },
        outside: { person: num(b.f1_out_person), kitchen: num(b.f1_out_kitchen) },
      },
      'الدور الثاني': {
        inside:  { person: num(b.f2_in_person),  kitchen: num(b.f2_in_kitchen) },
        outside: { person: num(b.f2_out_person), kitchen: num(b.f2_out_kitchen) },
      },
    },
    spiritual_day: { inside: num(b.sd_in), outside: num(b.sd_out) },
  };
  await settings.setPricing(pricing);
  req.flash('success', 'تم حفظ الأسعار الجديدة بنجاح ✅ — الفورمات هتستخدمها فوراً.');
  res.redirect('/pricing');
}));

module.exports = router;
