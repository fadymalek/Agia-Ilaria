const express = require('express');
const { bookings, generateBookingNumber, nextId } = require('../db');
const requireAuth = require('../middleware/requireAuth');
const router = express.Router();

router.use(requireAuth);

function buildBooking(data, extra = {}) {
  const paid = parseFloat(data.paid_amount) || 0;
  const total = parseFloat(data.total_amount) || 0;
  return {
    booking_type: data.booking_type,
    status: data.status || 'confirmed',
    sector_name: data.sector_name || null,
    church_name: data.church_name,
    priest_name: data.priest_name || null,
    priest_phone: data.priest_phone || null,
    supervisor_name: data.supervisor_name || null,
    supervisor_phone: data.supervisor_phone || null,
    category: data.category || null,
    num_people: parseInt(data.num_people) || 0,
    area: data.area || null,
    house_supervisor: data.house_supervisor || null,
    start_date: data.start_date || null,
    end_date: data.end_date || null,
    floor_number: data.floor_number || null,
    age_group: data.age_group || null,
    num_days: parseInt(data.num_days) || null,
    event_date: data.event_date || null,
    start_time: data.start_time || null,
    end_time: data.end_time || null,
    service_type: data.service_type || null,
    total_amount: total,
    paid_amount: paid,
    remaining_amount: total - paid,
    notes: data.notes || null,
    signature_name: data.signature_name || null,
    updated_at: new Date().toISOString(),
    ...extra
  };
}

router.get('/', (req, res) => {
  const { search, type, status, from, to } = req.query;
  let list = bookings.findAll();

  if (search) {
    const s = search.toLowerCase();
    list = list.filter(b =>
      (b.church_name || '').toLowerCase().includes(s) ||
      (b.priest_name || '').toLowerCase().includes(s) ||
      (b.booking_number || '').toLowerCase().includes(s) ||
      (b.supervisor_name || '').toLowerCase().includes(s)
    );
  }
  if (type) list = list.filter(b => b.booking_type === type);
  if (status) list = list.filter(b => b.status === status);
  if (from) list = list.filter(b => (b.start_date || b.event_date || '') >= from);
  if (to) list = list.filter(b => (b.end_date || b.event_date || b.start_date || '') <= to);

  list = list.reverse();

  const stats = {
    total: bookings.count(),
    retreat: bookings.count(b => b.booking_type === 'retreat'),
    spiritual: bookings.count(b => b.booking_type === 'spiritual_day'),
    pending: bookings.count(b => b.status === 'pending'),
  };

  res.render('bookings/index', { bookings: list, stats, query: req.query });
});

router.get('/new', (req, res) => {
  const type = req.query.type;
  if (!type || !['retreat', 'spiritual_day'].includes(type)) {
    return res.render('bookings/select-type');
  }
  res.render('bookings/new', { type, booking: null });
});

router.post('/', (req, res) => {
  const booking_number = generateBookingNumber();
  const id = nextId();
  const booking = buildBooking(req.body, {
    id, booking_number, source: 'admin',
    created_by: req.session.user.id,
    created_at: new Date().toISOString(),
  });
  bookings.insert(booking);
  req.flash('success', `تم تسجيل الحجز بنجاح - رقم الحجز: ${booking_number}`);
  res.redirect('/bookings');
});

router.get('/:id', (req, res) => {
  const booking = bookings.findById(parseInt(req.params.id));
  if (!booking) { req.flash('error', 'الحجز غير موجود'); return res.redirect('/bookings'); }
  res.render('bookings/show', { booking });
});

router.get('/:id/edit', (req, res) => {
  const booking = bookings.findById(parseInt(req.params.id));
  if (!booking) { req.flash('error', 'الحجز غير موجود'); return res.redirect('/bookings'); }
  res.render('bookings/new', { type: booking.booking_type, booking });
});

router.put('/:id', (req, res) => {
  const updates = buildBooking(req.body);
  bookings.update(parseInt(req.params.id), updates);
  req.flash('success', 'تم تحديث الحجز بنجاح');
  res.redirect(`/bookings/${req.params.id}`);
});

router.delete('/:id', (req, res) => {
  bookings.remove(parseInt(req.params.id));
  req.flash('success', 'تم حذف الحجز');
  res.redirect('/bookings');
});

module.exports = router;
