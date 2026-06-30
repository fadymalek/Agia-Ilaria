const express = require('express');
const { bookings, generateBookingNumber } = require('../db');
const { VALID_TYPES, cairoToday, bookingDate, bookingWhen } = require('../lib/helpers');
const requireAuth = require('../middleware/requireAuth');
const router = express.Router();

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ترتيب: الجاري النهاردة أولاً، ثم القادم (الأقرب أولاً)، ثم المنتهي (الأحدث أولاً)
const WHEN_ORDER = { today: 0, upcoming: 1, past: 2 };
function compareBookings(a, b) {
  const ga = WHEN_ORDER[a._when] ?? 3;
  const gb = WHEN_ORDER[b._when] ?? 3;
  if (ga !== gb) return ga - gb;
  const da = bookingDate(a);
  const db = bookingDate(b);
  if (a._when === 'past') return db.localeCompare(da);
  return da.localeCompare(db);
}

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

router.get('/', wrap(async (req, res) => {
  const { search, type, status, from, to } = req.query;
  const all = await bookings.findAll();
  let list = all.slice();

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

  // حالة التوقيت لكل حجز ثم الترتيب بالتواريخ
  const today = cairoToday();
  list.forEach(b => { b._when = bookingWhen(b, today); });
  list.sort(compareBookings);

  // حجوزات النهاردة (للتنبيه) + الطلبات المعلّقة
  const todayList = list.filter(b => b._when === 'today');
  const pendingList = all.filter(b => b.status === 'pending');

  const stats = {
    total: all.length,
    retreat: all.filter(b => b.booking_type === 'retreat').length,
    individual: all.filter(b => b.booking_type === 'individual_retreat').length,
    spiritual: all.filter(b => b.booking_type === 'spiritual_day').length,
    pending: pendingList.length,
  };

  res.render('bookings/index', {
    bookings: list, stats, query: req.query,
    todayCount: todayList.length, pendingCount: pendingList.length,
  });
}));

router.get('/new', (req, res) => {
  const type = req.query.type;
  if (!type || !VALID_TYPES.includes(type)) {
    return res.render('bookings/select-type');
  }
  res.render('bookings/new', { type, booking: null });
});

router.post('/', wrap(async (req, res) => {
  const booking_number = await generateBookingNumber();
  const booking = buildBooking(req.body, {
    booking_number, source: 'admin',
    created_by: req.session.user.id,
    created_at: new Date().toISOString(),
  });
  await bookings.insert(booking);
  req.flash('success', `تم تسجيل الحجز بنجاح - رقم الحجز: ${booking_number}`);
  res.redirect('/bookings');
}));

router.get('/:id', wrap(async (req, res) => {
  const booking = await bookings.findById(parseInt(req.params.id));
  if (!booking) { req.flash('error', 'الحجز غير موجود'); return res.redirect('/bookings'); }
  res.render('bookings/show', { booking });
}));

router.get('/:id/edit', wrap(async (req, res) => {
  const booking = await bookings.findById(parseInt(req.params.id));
  if (!booking) { req.flash('error', 'الحجز غير موجود'); return res.redirect('/bookings'); }
  res.render('bookings/new', { type: booking.booking_type, booking });
}));

router.put('/:id', wrap(async (req, res) => {
  const updates = buildBooking(req.body);
  await bookings.update(parseInt(req.params.id), updates);
  req.flash('success', 'تم تحديث الحجز بنجاح');
  res.redirect(`/bookings/${req.params.id}`);
}));

router.delete('/:id', wrap(async (req, res) => {
  await bookings.remove(parseInt(req.params.id));
  req.flash('success', 'تم حذف الحجز');
  res.redirect('/bookings');
}));

// الموافقة على طلب (تأكيد)
router.post('/:id/approve', wrap(async (req, res) => {
  await bookings.update(parseInt(req.params.id), { status: 'confirmed', updated_at: new Date().toISOString() });
  req.flash('success', 'تمت الموافقة على الطلب وتأكيد الحجز');
  res.redirect(req.get('referer') || '/bookings');
}));

// رفض طلب (إلغاء)
router.post('/:id/reject', wrap(async (req, res) => {
  await bookings.update(parseInt(req.params.id), { status: 'cancelled', updated_at: new Date().toISOString() });
  req.flash('success', 'تم رفض الطلب');
  res.redirect(req.get('referer') || '/bookings');
}));

module.exports = router;
