// أنواع الحجوزات وبياناتها (تسمية + أيقونة + ألوان) — مصدر واحد للحقيقة
// ألوان هادئة عصرية متناسقة مع الهوية الدهبية، ومميزة عن بعضها
const TYPES = {
  retreat: {
    key: 'retreat', label: 'خلوة جماعية', icon: 'bi-moon-stars-fill',
    color: '#107C77', bg: '#D7EFED',          // تركوازي
  },
  individual_retreat: {
    key: 'individual_retreat', label: 'خلوة فردية', icon: 'bi-person-hearts',
    color: '#9A4C6D', bg: '#F5E3EB',          // خمري هادئ
  },
  spiritual_day: {
    key: 'spiritual_day', label: 'يوم روحي', icon: 'bi-brightness-high-fill',
    color: '#5E7D2E', bg: '#E8EFD7',          // زيتي دافئ
  },
};

const VALID_TYPES = Object.keys(TYPES);

function typeInfo(t) {
  return TYPES[t] || TYPES.retreat;
}

// نوع متعدد الأيام (له تاريخ بداية ونهاية) — كل أنواع الخلوة
function isStayType(t) {
  return t !== 'spiritual_day';
}

// تاريخ اليوم بصيغة YYYY-MM-DD بتوقيت القاهرة (الخادم على Vercel يعمل بتوقيت UTC)
function cairoToday() {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

// التاريخ المعتمد للترتيب
function bookingDate(b) {
  return b.event_date || b.start_date || '';
}

// حالة الحجز بالنسبة للوقت: today (الدور النهاردة/جارية) | upcoming (قادم) | past (خلص) | null
function bookingWhen(b, today) {
  today = today || cairoToday();
  if (b.booking_type === 'spiritual_day') {
    const d = b.event_date;
    if (!d) return null;
    if (d === today) return 'today';
    return d < today ? 'past' : 'upcoming';
  }
  // خلوة (جماعية/فردية): فترة من start_date إلى end_date
  const start = b.start_date;
  if (!start) return null;
  const end = b.end_date || start;
  if (today >= start && today <= end) return 'today';
  return end < today ? 'past' : 'upcoming';
}

// ===== كشف تعارض الحجوزات (نفس الدور + تواريخ متداخلة) =====
// فترات الإقامة لكل حجز (خلوة جماعية = دور واحد، فردية = دور لكل فرد)
function stayIntervals(b) {
  if (!b || b.status === 'cancelled') return [];
  if (b.booking_type === 'individual_retreat' && Array.isArray(b.persons)) {
    return b.persons
      .filter(p => p.floor && p.start_date)
      .map(p => ({ floor: p.floor, start: p.start_date, end: p.end_date || p.start_date }));
  }
  if (b.booking_type !== 'spiritual_day' && b.floor_number && b.start_date) {
    return [{ floor: b.floor_number, start: b.start_date, end: b.end_date || b.start_date }];
  }
  return [];
}

function intervalsConflict(x, y) {
  const floorClash = x.floor === y.floor || x.floor === 'كامل البيت' || y.floor === 'كامل البيت';
  const dateOverlap = x.start <= y.end && y.start <= x.end;
  return floorClash && dateOverlap;
}

// يعيد Set بمعرّفات الحجوزات المتعارضة
function findConflictIds(list) {
  const ids = new Set();
  const items = (list || [])
    .map(b => ({ id: b.id, intervals: stayIntervals(b) }))
    .filter(x => x.intervals.length);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const clash = items[i].intervals.some(x => items[j].intervals.some(y => intervalsConflict(x, y)));
      if (clash) { ids.add(items[i].id); ids.add(items[j].id); }
    }
  }
  return ids;
}

// رابط واتساب لرقم مصري + رسالة جاهزة
function waLink(phone, text) {
  if (!phone) return null;
  let p = String(phone).replace(/\D/g, '');
  if (!p) return null;
  if (p.startsWith('00')) p = p.slice(2);
  else if (p.startsWith('0')) p = '20' + p.slice(1);   // رقم محلي مصري
  else if (!p.startsWith('20')) p = '20' + p;
  return `https://wa.me/${p}?text=${encodeURIComponent(text || '')}`;
}

module.exports = { TYPES, VALID_TYPES, typeInfo, isStayType, cairoToday, bookingDate, bookingWhen, waLink, findConflictIds };
