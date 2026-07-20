const express = require('express');
const ExcelJS = require('exceljs');
const { bookings, generateBookingNumber } = require('../db');
const { VALID_TYPES, cairoToday, bookingDate, bookingWhen, typeInfo } = require('../lib/helpers');
const requireAuth = require('../middleware/requireAuth');
const router = express.Router();

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const STATUS_LABEL = { confirmed: 'مؤكد', pending: 'في الانتظار', cancelled: 'ملغي' };

// تطبيق فلاتر البحث على القائمة (مشترك بين العرض والتصدير)
function applyFilters(list, q) {
  const { search, type, status, from, to } = q;
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
  return list;
}

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

// المستخدم العادي: عرض فقط — يُسمح بقائمة الحجوزات وصفحة تفاصيل حجز فقط.
// أي إضافة/تعديل/حذف/تصدير/نسخة احتياطية/محذوفات للمسؤول الكامل فقط.
router.use((req, res, next) => {
  if (req.session.user && req.session.user.role === 'admin') return next();
  const viewOnly = req.method === 'GET' && (req.path === '/' || /^\/\d+$/.test(req.path));
  if (viewOnly) return next();
  req.flash('error', 'هذه العملية متاحة للمسؤول فقط');
  return res.redirect('/bookings');
});

// الخلوة الفردية: كل فرد له بياناته الكاملة الخاصة (تختلف من فرد لفرد)
function parsePersons(data) {
  if (!data.persons) return [];
  const arr = Array.isArray(data.persons) ? data.persons : Object.values(data.persons);
  const t = v => (v == null ? '' : String(v)).trim() || null;
  return arr
    .filter(p => p && (p.name || '').trim())
    .map(p => ({
      name: (p.name || '').trim(),
      age: t(p.age),
      floor: t(p.floor),
      phone: t(p.phone),
      church: t(p.church),
      start_date: t(p.start_date),
      end_date: t(p.end_date),
      confession_father: t(p.confession_father),
      confession_father_phone: t(p.confession_father_phone),
      amount: parseFloat(p.amount) || 0,
      form_status: t(p.form_status),
      supervisor: t(p.supervisor),
      house_supervisor: t(p.house_supervisor),
    }));
}

function buildBooking(data, extra = {}) {
  const paid = parseFloat(data.paid_amount) || 0;
  const total = parseFloat(data.total_amount) || 0;
  const result = {
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
    sector_scope: data.sector_scope || null,
    kitchen_included: data.kitchen_included ? true : false,
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
  };

  if (data.booking_type === 'individual_retreat') {
    const persons = parsePersons(data);
    result.persons = persons;
    result.num_people = persons.length;
    // المالية للمجموعة = مجموع مبالغ الأفراد
    const sum = persons.reduce((s, p) => s + (p.amount || 0), 0);
    result.total_amount = sum;
    result.paid_amount = sum;
    result.remaining_amount = 0;
    // تواريخ الحجز على المستوى العام (لأجل القائمة والتقويم) من مدى تواريخ الأفراد
    const starts = persons.map(p => p.start_date).filter(Boolean).sort();
    const ends = persons.map(p => p.end_date || p.start_date).filter(Boolean).sort();
    result.start_date = starts[0] || null;
    result.end_date = ends[ends.length - 1] || null;
  }

  return { ...result, ...extra };
}

router.get('/', wrap(async (req, res) => {
  const all = await bookings.findAll();
  let list = applyFilters(all.slice(), req.query);

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

// تصدير قائمة الحجوزات (مع نفس الفلاتر) إلى Excel
router.get('/export', wrap(async (req, res) => {
  const all = await bookings.findAll();
  const list = applyFilters(all.slice(), req.query)
    .sort((a, b) => bookingDate(a).localeCompare(bookingDate(b)));

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('الحجوزات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'رقم الحجز', key: 'num', width: 16 },
    { header: 'اسم الكنيسة', key: 'church', width: 28 },
    { header: 'القطاع', key: 'sector', width: 16 },
    { header: 'النوع', key: 'type', width: 14 },
    { header: 'الفئة', key: 'category', width: 12 },
    { header: 'من تاريخ', key: 'start', width: 13 },
    { header: 'إلى تاريخ', key: 'end', width: 13 },
    { header: 'الكاهن', key: 'priest', width: 18 },
    { header: 'تليفون الكاهن', key: 'priest_phone', width: 15 },
    { header: 'المشرفة المسؤولة', key: 'supervisor', width: 18 },
    { header: 'العدد', key: 'people', width: 8 },
    { header: 'الإجمالي', key: 'total', width: 12 },
    { header: 'المدفوع', key: 'paid', width: 12 },
    { header: 'المتبقي', key: 'remaining', width: 12 },
    { header: 'الحالة', key: 'status', width: 12 },
    { header: 'ملاحظات', key: 'notes', width: 28 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 22;
  ws.getRow(1).eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B6914' } }; });

  list.forEach(b => ws.addRow({
    num: b.booking_number, church: b.church_name || '', sector: b.sector_name || '',
    type: typeInfo(b.booking_type).label, category: b.category || '',
    start: b.start_date || b.event_date || '', end: b.end_date || '',
    priest: b.priest_name || '', priest_phone: b.priest_phone || '', supervisor: b.supervisor_name || '',
    people: b.num_people || 0, total: b.total_amount || 0, paid: b.paid_amount || 0,
    remaining: b.remaining_amount || 0, status: STATUS_LABEL[b.status] || b.status || '', notes: b.notes || '',
  }));
  ['total', 'paid', 'remaining'].forEach(k => { ws.getColumn(k).numFmt = '#,##0'; });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="hilaria-bookings-${cairoToday()}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

// سلة المحذوفات
router.get('/trash', wrap(async (req, res) => {
  const deleted = await bookings.findDeleted();
  res.render('bookings/trash', { bookings: deleted });
}));

// نسخة احتياطية كاملة (JSON) بكل الحقول والتفاصيل — للحفظ المحلي عند المستخدم
router.get('/backup', wrap(async (req, res) => {
  const active = await bookings.findAll();
  const deleted = await bookings.findDeleted();
  const payload = {
    app: 'بيت القديسة ايلاريا',
    exported_at: new Date().toISOString(),
    active_count: active.length,
    deleted_count: deleted.length,
    bookings: active,
    deleted_bookings: deleted,
  };
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="hilaria-backup-${cairoToday()}.json"`);
  res.send(JSON.stringify(payload, null, 2));
}));

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
  const id = parseInt(req.params.id);
  await bookings.update(id, updates);
  req.flash('success', 'تم تحديث الحجز بنجاح');
  res.redirect(`/bookings/${req.params.id}`);
}));

// حذف ناعم → ينقل لسلة المحذوفات (يمكن استرجاعه)
router.delete('/:id', wrap(async (req, res) => {
  await bookings.softDelete(parseInt(req.params.id));
  req.flash('success', 'تم نقل الحجز لسلة المحذوفات — تقدر ترجّعه');
  res.redirect('/bookings');
}));

// استرجاع حجز من سلة المحذوفات
router.post('/:id/restore', wrap(async (req, res) => {
  await bookings.restore(parseInt(req.params.id));
  req.flash('success', 'تم استرجاع الحجز بنجاح');
  res.redirect('/bookings/trash');
}));

// حذف نهائي (لا رجعة فيه)
router.post('/:id/purge', wrap(async (req, res) => {
  await bookings.purge(parseInt(req.params.id));
  req.flash('success', 'تم حذف الحجز نهائياً');
  res.redirect('/bookings/trash');
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
