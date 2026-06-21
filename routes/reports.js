const express = require('express');
const { bookings } = require('../db');
const requireAuth = require('../middleware/requireAuth');
const router = express.Router();

router.use(requireAuth);

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/', wrap(async (req, res) => {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - dayOfWeek);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const from = req.query.from || weekStart.toISOString().split('T')[0];
  const to = req.query.to || weekEnd.toISOString().split('T')[0];

  const all = await bookings.findAll();
  const list = all.filter(b => {
    const a = b.start_date || b.event_date || '';
    const z = b.end_date || b.event_date || b.start_date || '';
    return (a >= from && a <= to) || (z >= from && z <= to) || (a <= from && z >= to);
  }).sort((a, b) => {
    const da = a.event_date || a.start_date || '';
    const db2 = b.event_date || b.start_date || '';
    return da.localeCompare(db2);
  });

  const totals = {
    count: list.length,
    total_amount: list.reduce((s, b) => s + (b.total_amount || 0), 0),
    paid_amount: list.reduce((s, b) => s + (b.paid_amount || 0), 0),
    remaining_amount: list.reduce((s, b) => s + (b.remaining_amount || 0), 0),
    retreat_count: list.filter(b => b.booking_type === 'retreat').length,
    spiritual_count: list.filter(b => b.booking_type === 'spiritual_day').length,
    total_people: list.reduce((s, b) => s + (b.num_people || 0), 0),
  };

  res.render('reports/index', { bookings: list, totals, from, to });
}));

module.exports = router;
