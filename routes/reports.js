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

// ===== ثوابت تنسيق Excel =====
const XL = {
  gold: 'FF8B6914', goldDark: 'FF5C3D0A', cream: 'FFF7ECD3', creamDeep: 'FFEFD9A8',
  border: 'FFE3D6B4', zebra: 'FFFBF6EA', white: 'FFFFFFFF',
  green: 'FF1B5E20', red: 'FFB71C1C', teal: 'FF107C77', wine: 'FF9A4C6D', olive: 'FF5E7D2E',
  headBg: 'FF107C77',
};
const thinAll = c => ({ top: { style: 'thin', color: { argb: c } }, bottom: { style: 'thin', color: { argb: c } }, left: { style: 'thin', color: { argb: c } }, right: { style: 'thin', color: { argb: c } } });

// تصدير التقرير إلى ملف Excel (ورقة ملخص وتحليلات + ورقة تفاصيل)
router.get('/export', wrap(async (req, res) => {
  const { from, to, list, totals, analytics, insights } = await getReport(req.query);
  const collect = analytics.collectionRate;

  const wb = new ExcelJS.Workbook();
  wb.creator = 'بيت القديسة ايلاريا';
  wb.created = new Date();

  // ============ ورقة (1): ملخص وتحليلات ============
  const s = wb.addWorksheet('ملخص وتحليلات', { views: [{ rightToLeft: true, showGridLines: false }] });
  s.columns = [{ width: 26 }, { width: 20 }, { width: 4 }, { width: 26 }, { width: 20 }];

  // عنوان رئيسي
  s.mergeCells('A1:E1');
  const t1 = s.getCell('A1');
  t1.value = 'بيت القديسة ايلاريا — تقرير وإحصائيات الحجوزات';
  t1.font = { bold: true, size: 16, color: { argb: XL.white } };
  t1.alignment = { horizontal: 'center', vertical: 'middle' };
  t1.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.gold } };
  s.getRow(1).height = 32;
  s.mergeCells('A2:E2');
  const t2 = s.getCell('A2');
  t2.value = `الفترة من ${from} إلى ${to}`;
  t2.font = { italic: true, size: 11, color: { argb: XL.goldDark } };
  t2.alignment = { horizontal: 'center' };
  s.getRow(2).height = 20;

  let r = 4;
  // عنوان قسم صغير
  const section = title => {
    s.mergeCells(`A${r}:E${r}`);
    const c = s.getCell(`A${r}`);
    c.value = title;
    c.font = { bold: true, size: 12, color: { argb: XL.white } };
    c.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.headBg } };
    s.getRow(r).height = 24;
    r++;
  };
  // بطاقة مؤشر: تسمية | قيمة (تبدأ من عمود col)
  const kpi = (col, label, value, color) => {
    const lc = s.getCell(r, col), vc = s.getCell(r, col + 1);
    lc.value = label; vc.value = value;
    lc.font = { bold: true, color: { argb: XL.goldDark } };
    lc.alignment = { horizontal: 'right', indent: 1 };
    lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.cream } };
    vc.font = { bold: true, size: 12, color: { argb: color || XL.goldDark } };
    vc.alignment = { horizontal: 'center' };
    vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.white } };
    lc.border = thinAll(XL.border); vc.border = thinAll(XL.border);
    s.getRow(r).height = 20;
  };

  // --- المؤشرات الرئيسية (شبكة عمودين) ---
  section('المؤشرات الرئيسية');
  const kpis = [
    ['إجمالي الحجوزات', totals.count, XL.goldDark],
    ['إجمالي الأفراد', totals.total_people, XL.teal],
    ['المبلغ المحصّل (ج)', totals.paid_amount, XL.green],
    ['المبلغ المتبقّي (ج)', totals.remaining_amount, XL.red],
    ['معدل التحصيل', `${collect}%`, collect >= 70 ? XL.green : XL.red],
    ['طلبات في الانتظار', totals.pending_count, XL.wine],
  ];
  for (let i = 0; i < kpis.length; i += 2) {
    kpi(1, kpis[i][0], kpis[i][1], kpis[i][2]);
    if (kpis[i + 1]) kpi(4, kpis[i + 1][0], kpis[i + 1][1], kpis[i + 1][2]);
    r++;
  }
  r++;

  // --- رؤى للإدارة ---
  section('رؤى للإدارة');
  [
    ['أكثر نوع حجزاً', insights.topType],
    ['أكثر شهر ازدحاماً', insights.busiestMonth],
    ['أكثر كنيسة حجزاً', insights.topChurch],
    ['متوسط عدد الأفراد للحجز', insights.avgPeople],
    ['معدل التحصيل العام', `${insights.collectionRate}%`],
  ].forEach(([label, val]) => {
    s.mergeCells(`A${r}:B${r}`);
    const lc = s.getCell(`A${r}`); lc.value = label;
    lc.font = { bold: true, color: { argb: XL.goldDark } };
    lc.alignment = { horizontal: 'right', indent: 1 };
    lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.cream } };
    s.mergeCells(`C${r}:E${r}`);
    const vc = s.getCell(`C${r}`); vc.value = val;
    vc.font = { color: { argb: XL.goldDark } };
    vc.alignment = { horizontal: 'right', indent: 1 };
    lc.border = thinAll(XL.border); vc.border = thinAll(XL.border);
    r++;
  });
  r++;

  // جدول تحليلي صغير: عنوانان + صفوف
  const miniTable = (title, head, rows) => {
    section(title);
    // رأس الجدول
    const h1 = s.getCell(r, 1), h2 = s.getCell(r, 2);
    h1.value = head[0]; h2.value = head[1];
    [h1, h2].forEach(c => {
      c.font = { bold: true, color: { argb: XL.white } };
      c.alignment = { horizontal: 'center' };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.gold } };
      c.border = thinAll(XL.border);
    });
    r++;
    rows.forEach((row, i) => {
      const lc = s.getCell(r, 1), vc = s.getCell(r, 2);
      lc.value = row[0]; vc.value = row[1];
      lc.alignment = { horizontal: 'right', indent: 1 };
      vc.alignment = { horizontal: 'center' };
      const bg = i % 2 ? XL.zebra : XL.white;
      lc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      vc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      lc.border = thinAll(XL.border); vc.border = thinAll(XL.border);
      r++;
    });
    r++;
  };

  miniTable('الحجوزات حسب النوع', ['النوع', 'العدد'], [
    ['خلوة جماعية', totals.retreat_count],
    ['خلوة فردية', totals.individual_count],
    ['يوم روحي', totals.spiritual_count],
  ]);
  miniTable('الحجوزات حسب الحالة', ['الحالة', 'العدد'], [
    ['مؤكد', totals.confirmed_count],
    ['في الانتظار', totals.pending_count],
    ['ملغي', totals.cancelled_count],
  ]);
  if (analytics.byMonth.length) {
    miniTable('الحجوزات شهرياً', ['الشهر', 'عدد الحجوزات'], analytics.byMonth.map(m => [m.label, m.count]));
  }
  if (analytics.topChurches.length) {
    miniTable('أكثر الكنائس حجزاً', ['الكنيسة', 'العدد'], analytics.topChurches.map(c => [c.name, c.count]));
  }
  if (analytics.byFloor.length) {
    miniTable('إشغال الأدوار', ['الدور', 'عدد الحجوزات'], analytics.byFloor.map(f => [f.label, f.count]));
  }

  // ============ ورقة (2): تفاصيل الحجوزات ============
  const ws = wb.addWorksheet('تفاصيل الحجوزات', { views: [{ rightToLeft: true, state: 'frozen', ySplit: 3 }] });

  ws.mergeCells('A1', 'S1');
  ws.getCell('A1').value = `تفاصيل الحجوزات — من ${from} إلى ${to}`;
  ws.getCell('A1').font = { bold: true, size: 14, color: { argb: XL.goldDark } };
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
    { header: 'المشرفة', key: 'supervisor', width: 16 },
    { header: 'تليفون المشرفة', key: 'supervisor_phone', width: 15 },
    { header: 'العدد', key: 'people', width: 8 },
    { header: 'الإجمالي', key: 'total', width: 12 },
    { header: 'المدفوع', key: 'paid', width: 12 },
    { header: 'المتبقي', key: 'remaining', width: 12 },
    { header: 'الحالة', key: 'status', width: 12 },
    { header: 'ملاحظات', key: 'notes', width: 30 },
  ];

  const headerRow = ws.getRow(3);
  columns.forEach((c, i) => { headerRow.getCell(i + 1).value = c.header; });
  ws.columns = columns.map(c => ({ key: c.key, width: c.width }));
  headerRow.font = { bold: true, color: { argb: XL.white } };
  headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  headerRow.height = 22;
  headerRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.gold } };
    cell.border = thinAll(XL.border);
  });

  const statusColor = { confirmed: XL.green, pending: 'FFB26A00', cancelled: 'FF9E9E9E' };
  list.forEach((b, i) => {
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
    row.height = 19;
    const bg = i % 2 ? XL.zebra : XL.white;
    row.eachCell(cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.border = { bottom: { style: 'hair', color: { argb: XL.border } } };
    });
    // تلوين خلية الحالة + المتبقي
    const stCell = row.getCell('status');
    stCell.font = { bold: true, color: { argb: statusColor[b.status] || XL.goldDark } };
    stCell.alignment = { horizontal: 'center', vertical: 'middle' };
    const remCell = row.getCell('remaining');
    remCell.font = { bold: true, color: { argb: (b.remaining_amount || 0) > 0 ? XL.red : XL.green } };
    row.getCell('paid').font = { color: { argb: XL.green } };
    ['num', 'type', 'category', 'people', 'start', 'end'].forEach(k => { row.getCell(k).alignment = { horizontal: 'center', vertical: 'middle' }; });
  });

  // صف الإجماليات
  const totalRow = ws.addRow({
    church: 'الإجمالي', people: totals.total_people,
    total: totals.total_amount, paid: totals.paid_amount, remaining: totals.remaining_amount,
  });
  totalRow.height = 22;
  totalRow.font = { bold: true, size: 11 };
  totalRow.eachCell(cell => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: XL.creamDeep } };
    cell.border = { top: { style: 'medium', color: { argb: XL.gold } } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  ['total', 'paid', 'remaining'].forEach(key => { ws.getColumn(key).numFmt = '#,##0'; });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="hilaria-report-${from}_${to}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}));

module.exports = router;
