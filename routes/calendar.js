const express = require('express');
const { bookings } = require('../db');
const { typeInfo, isStayType } = require('../lib/helpers');
const requireAuth = require('../middleware/requireAuth');
const router = express.Router();

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.use(requireAuth);

function addDay(dateStr) {
  const dt = new Date(dateStr + 'T00:00:00');
  dt.setDate(dt.getDate() + 1);
  return dt.toISOString().slice(0, 10);
}

router.get('/', (req, res) => {
  res.render('calendar/index');
});

// تغذية أحداث التقويم بصيغة FullCalendar
router.get('/events', wrap(async (req, res) => {
  const all = await bookings.findAll();
  const events = all.map(b => {
    const ti = typeInfo(b.booking_type);
    const ev = {
      id: b.id,
      title: b.church_name || 'حجز',
      url: `/bookings/${b.id}`,
      backgroundColor: ti.color,
      borderColor: ti.color,
    };

    if (isStayType(b.booking_type)) {
      if (!b.start_date) return null;
      ev.start = b.start_date;
      ev.end = addDay(b.end_date || b.start_date); // النهاية غير شاملة في FullCalendar
      ev.allDay = true;
    } else {
      if (!b.event_date) return null;
      if (b.start_time) {
        ev.start = `${b.event_date}T${b.start_time}`;
        if (b.end_time) ev.end = `${b.event_date}T${b.end_time}`;
      } else {
        ev.start = b.event_date;
        ev.allDay = true;
      }
    }

    if (b.status === 'cancelled') {
      ev.backgroundColor = '#9E9E9E'; ev.borderColor = '#9E9E9E';
      ev.title = '(ملغي) ' + ev.title;
    } else if (b.status === 'pending') {
      ev.title = '⏳ ' + ev.title;
    }
    return ev;
  }).filter(Boolean);

  res.json(events);
}));

module.exports = router;
