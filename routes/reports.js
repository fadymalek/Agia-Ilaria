const express = require('express');
const ExcelJS = require('exceljs');
const { bookings } = require('../db');
const { typeInfo } = require('../lib/helpers');
const requireAuth = require('../middleware/requireAuth');
const router = express.Router();

router.use(requireAuth);

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const STATUS_LABEL = { confirmed: 'مؤكد', pending: 'في الانتظار', cancelled: 'ملغي' };

// نطاق التاريخ (افتراضياً الأسبوع الحالي) + الحجوزات داخله + الإجماليات
async function getReport(query) {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - dayOfWeek);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const from = query.from || weekStart.toISOString().split('T')[0];
  const to = query.to || weekEnd.toISOString().split('T')[0];

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
  };

  return { from, to, list, totals };
}

router.get('/', wrap(async (req, res) => {
  const { from, to, list, totals } = await getReport(req.query);
  res.render('reports/index', { bookings: list, totals, from, to });
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
