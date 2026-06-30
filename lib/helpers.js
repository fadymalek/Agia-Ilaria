// أنواع الحجوزات وبياناتها (تسمية + أيقونة + ألوان) — مصدر واحد للحقيقة
const TYPES = {
  retreat: {
    key: 'retreat', label: 'خلوة جماعية', icon: 'bi-moon-stars-fill',
    color: '#1565C0', bg: '#E3F2FD',
  },
  individual_retreat: {
    key: 'individual_retreat', label: 'خلوة فردية', icon: 'bi-person-hearts',
    color: '#6A1B9A', bg: '#F3E5F5',
  },
  spiritual_day: {
    key: 'spiritual_day', label: 'يوم روحي', icon: 'bi-brightness-high-fill',
    color: '#2E7D32', bg: '#E8F5E9',
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

module.exports = { TYPES, VALID_TYPES, typeInfo, isStayType, cairoToday, bookingDate, bookingWhen, waLink };
