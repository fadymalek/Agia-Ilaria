const express = require('express');
const ExcelJS = require('exceljs');
const { bookings } = require('../db');
const { typeInfo } = require('../lib/helpers');
const requireAuth = require('../middleware/requireAuth');
const router = express.Router();

router.use(requireAuth);

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const STATUS_LABEL = { confirmed: 'مؤكد', pending: 'في الانتظار', cancelled: 'ملغي' };
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

// حساب النطاق حسب المفتاح المختصر (أسبوع/شهر/سنة/الكل)
function presetRange(preset) {
  const today = new Date();
  const y = today.getFullYear();
  const fmt = d => d.toISOString().split('T')[0];
  if (preset === 'week') {
    const s = new Date(today); s.setDate(today.getDate() - today.getDay());
    const e = new Date(s); e.setDate(s.getDate() + 6);
    return { from: fmt(s), to: fmt(e) };
  }
  if (preset === 'month') {
    return { from: fmt(new Date(y, today.getMonth(), 1)), to: fmt(new Date(y, today.getMonth() + 1, 0)) };
  }
  if (preset === 'all') return { from: '2000-01-01', to: '2100-12-31' };
  return { from: `${y}-01-01`, to: `${y}-12-31` }; // السنة الحالية (الافتراضي)
}

// نطاق + الحجوزات داخله + الإجماليات + تحليلات للإدارة
async function getReport(query) {
  const preset = query.range || 'year';
  const pr = presetRange(preset);
  const from = query.from || pr.from;
  const to = query.to || pr.to;

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
    individual_count: list.filter(b => b.booking_type === 'individual_retreat').length,
    spiritual_count: list.filter(b => b.booking_type === 'spiritual_day').length,
    total_people: list.reduce((s, b) => s + (b.num_people || 0), 0),
    confirmed_count: list.filter(b => b.status === 'confirmed').length,
    pending_count: list.filter(b => b.status === 'pending').length,
    cancelled_count: list.filter(b => b.status === 'cancelled').length,
  };

  // ===== تحليلات =====
  // حسب الشهر
  const monthMap = {};
  list.forEach(b => {
    const d = b.event_date || b.start_date || '';
    if (!d) return;
    const key = d.slice(0, 7); // YYYY-MM
    monthMap[key] = monthMap[key] || { count: 0, people: 0, paid: 0 };
    monthMap[key].count++;
    monthMap[key].people += b.num_people || 0;
    monthMap[key].paid += b.paid_amount || 0;
  });
  const byMonth = Object.keys(monthMap).sort().map(k => ({
    key: k, label: AR_MONTHS[parseInt(k.slice(5, 7), 10) - 1] + ' ' + k.slice(0, 4),
    count: monthMap[k].count, people: monthMap[k].people, paid: monthMap[k].paid,
  }));

  // إشغال الأدوار
  const floorMap = {};
  const addFloor = f => { const k = f || 'غير محدد'; floorMap[k] = (floorMap[k] || 0) + 1; };
  list.forEach(b => {
    if (b.booking_type === 'spiritual_day') return;
    if (b.booking_type === 'individual_retreat' && Array.isArray(b.persons)) {
      b.persons.forEach(p => addFloor(p.floor));
    } else if (b.booking_type === 'retreat') {
      addFloor(b.floor_number);
    }
  });
  const byFloor = Object.keys(floorMap).map(k => ({ label: k, count: floorMap[k] })).sort((a, b) => b.count - a.count);

  // أكثر الكنائس حجزاً
  const churchMap = {};
  list.forEach(b => { const n = (b.church_name || '—').trim(); churchMap[n] = (churchMap[n] || 0) + 1; });
  const topChurches = Object.keys(churchMap).map(k => ({ name: k, count: churchMap[k] }))
    .sort((a, b) => b.count - a.count).slice(0, 6);

  const collectionRate = totals.total_amount > 0 ? Math.round((totals.paid_amount / totals.total_amount) * 100) : 0;

  // رؤى نصية للإدارة
  const typeArr = [
    { key: 'retreat', label: 'خلوة جماعية', n: totals.retreat_count },
    { key: 'individual_retreat', label: 'خلوة فردية', n: totals.individual_count },
    { key: 'spiritual_day', label: 'يوم روحي', n: totals.spiritual_count },
  ].sort((a, b) => b.n - a.n);
  const busiestMonth = byMonth.slice().sort((a, b) => b.count - a.count)[0];
  const insights = {
    topType: typeArr[0] && typeArr[0].n > 0 ? typeArr[0].label : '—',
    busiestMonth: busiestMonth ? busiestMonth.label : '—',
    collectionRate,
    avgPeople: totals.count ? Math.round(totals.total_people / totals.count) : 0,
    topChurch: topChurches[0] && topChurches[0].count > 0 ? topChurches[0].name : '—',
  };

  const analytics = { byMonth, byFloor, topChurches, collectionRate };

  return { from, to, preset, list, totals, analytics, insights };
}

router.get('/', wrap(async (req, res) => {
  const data = await getReport(req.query);
  res.render('reports/index', { bookings: data.list, query: req.query, ...data });
}));

// تصدير التقرير إلى ملف Excel
router.get('/export', wrap(async (req, res) => {
  const { from, to, list, totals } = await getReport(req.query);

  const wb = new ExcelJS.Workbook();
  wb.creator = 'بيت القديسة ايلاريا';
  wb.created = new Date();
  const ws = wb.addWorksheet('الحجوزات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }] });

  // عنوان التقرير
  ws.mergeCells('A1', 'Q1');
  ws.getCell('A1').value = `بيت القديسة ايلاريا - تقرير الحجوزات من ${from} إلى ${to}`;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF5C3D0A' } };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 26;
  ws.addRow([]);

  const columns = [
    { header: 'رقم الحجز', key: 'num', width: 16 },
    { header: 'اسم الكنيسة', key: 'church', width: 28 },
    { header: 'القطاع', key: 'sector', width: 16 },
    { header: 'النوع', key: 'type', width: 14 },
    { header: 'الفئة', key: 'category', width: 12 },
    { header: 'من تاريخ', key: 'start', width: 13 },
    { header: 'إلى تاريخ', key: 'end', width: 13 },
    { header: 'من الساعة', key: 'start_time', width: 11 },
    { header: 'إلى الساعة', key: 'end_time', width: 11 },
    { header: 'الكاهن', key: 'priest', width: 18 },
    { header: 'تليفون الكاهن', key: 'priest_phone', width: 15 },
    { header: 'المشرف', key: 'supervisor', width: 16 },
    { header: 'تليفون المشرف', key: 'supervisor_phone', width: 15 },
    { header: 'العدد', key: 'people', width: 8 },
    { header: 'الإجمالي', key: 'total', width: 12 },
    { header: 'المدفوع', key: 'paid', width: 12 },
    { header: 'المتبقي', key: 'remaining', width: 12 },
    { header: 'الحالة', key: 'status', width: 12 },
    { header: 'ملاحظات', key: 'notes', width: 30 },
  ];

  // صف العناوين في السطر الثالث
  const headerRow = ws.getRow(3);
  columns.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
  ws.columns = columns.map(c => ({ key: c.key, width: c.width }));
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 22;
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B6914' } };
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCCCCCC' } } };
  });

  list.forEach(b => {
    const row = ws.addRow({
      num: b.booking_number,
      church: b.church_name || '',
      sector: b.sector_name || '',
      type: typeInfo(b.booking_type).label,
      category: b.category || '',
      start: b.start_date || b.event_date || '',
      end: b.end_date || '',
      start_time: b.start_time || '',
      end_time: b.end_time || '',
      priest: b.priest_name || '',
      priest_phone: b.priest_phone || '',
      supervisor: b.supervisor_name || '',
      supervisor_phone: b.supervisor_phone || '',
      people: b.num_people || 0,
      total: b.total_amount || 0,
      paid: b.paid_amount || 0,
      remaining: b.remaining_amount || 0,
      status: STATUS_LABEL[b.status] || b.status || '',
      notes: b.notes || '',
    });
    row.alignment = { vertical: 'middle' };
  });

  // صف الإجماليات
  const totalRow = ws.addRow({
    church: 'الإجمالي', people: totals.total_people,
    total: totals.total_amount, paid: totals.paid_amount, remaining: totals.remaining_amount,
  });
  totalRow.font = { bold: true };
  totalRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5E6C8' } };
  });

  // تنسيق أرقام المبالغ
  ['total', 'paid', 'remaining'].forEach(key => {
    ws.getColumn(key).numFmt = '#,##0';
  });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="hilaria-report-${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

module.exports = router;
