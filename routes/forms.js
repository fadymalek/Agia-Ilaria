const express = require('express');
const { bookings, generateBookingNumber } = require('../db');
const router = express.Router();

const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

router.get('/retreat', (req, res) => res.render('forms/retreat', { error: null }));
router.get('/spiritual-day', (req, res) => res.render('forms/spiritual-day', { error: null }));

// الخلوة الفردية تُسجَّل من المشرفين داخل النظام (وليست فورماً عاماً)
router.get('/individual', (req, res) => res.redirect('/bookings/new?type=individual_retreat'));

router.post('/retreat', wrap(async (req, res) => {
  const d = req.body;
  try {
    if (!d.church_name) throw new Error('اسم الكنيسة مطلوب');
    const booking_number = await generateBookingNumber();
    const paid = parseFloat(d.paid_amount) || 0;
    const total = parseFloat(d.total_amount) || 0;
    await bookings.insert({
      booking_number, booking_type: 'retreat', status: 'pending', source: 'form',
      sector_name: d.sector_name || null, church_name: d.church_name,
      priest_name: d.priest_name || null, priest_phone: d.priest_phone || null,
      supervisor_name: d.supervisor_name || null, supervisor_phone: d.supervisor_phone || null,
      age_group: d.age_group || null, num_people: parseInt(d.num_people) || 0,
      num_days: parseInt(d.num_days) || null, start_date: d.start_date || null, end_date: d.end_date || null,
      floor_number: d.floor_number || null, sector_scope: d.sector_scope || null,
      kitchen_included: d.kitchen_included ? true : false,
      total_amount: total, paid_amount: paid, remaining_amount: total - paid,
      signature_name: d.signature_name || null, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
    res.render('forms/success', { booking_number, type: 'retreat' });
  } catch (e) { res.render('forms/retreat', { error: e.message }); }
}));

router.post('/spiritual-day', wrap(async (req, res) => {
  const d = req.body;
  try {
    if (!d.church_name) throw new Error('اسم الكنيسة مطلوب');
    const booking_number = await generateBookingNumber();
    const paid = parseFloat(d.paid_amount) || 0;
    const total = parseFloat(d.total_amount) || 0;
    await bookings.insert({
      booking_number, booking_type: 'spiritual_day', status: 'pending', source: 'form',
      sector_name: d.sector_name || null, church_name: d.church_name,
      priest_name: d.priest_name || null, priest_phone: d.priest_phone || null,
      supervisor_name: d.supervisor_name || null, supervisor_phone: d.supervisor_phone || null,
      service_type: d.service_type || null, num_people: parseInt(d.num_people) || 0,
      sector_scope: d.sector_scope || null,
      event_date: d.event_date || null, start_time: d.start_time || null, end_time: d.end_time || null,
      total_amount: total, paid_amount: paid, remaining_amount: total - paid,
      signature_name: d.signature_name || null, created_at: new Date().toISOString(), updated_at: new Date().toISOString()
    });
    res.render('forms/success', { booking_number, type: 'spiritual_day' });
  } catch (e) { res.render('forms/spiritual-day', { error: e.message }); }
}));

module.exports = router;
