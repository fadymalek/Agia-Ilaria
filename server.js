require('dotenv').config();

const express = require('express');
const cookieSession = require('cookie-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');

const db = require('./db');
const helpers = require('./lib/helpers');

const app = express();

// helpers متاحة لكل القوالب (EJS)
app.locals.typeInfo = helpers.typeInfo;
app.locals.isStayType = helpers.isStayType;
app.locals.waLink = helpers.waLink;

// خلف بروكسي (Vercel / Render) لكي تعمل الكوكيز الآمنة بشكل صحيح
app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

// جلسات داخل كوكي موقّعة — تعمل على البيئات الـ serverless (Vercel)
app.use(cookieSession({
  name: 'hilaria_sess',
  secret: process.env.SESSION_SECRET || 'hilaria-2024-secret',
  maxAge: 8 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
}));

// connect-flash يحتاج توافقاً مع واجهة express-session (regenerate/save)
app.use((req, res, next) => {
  if (req.session && !req.session.regenerate) req.session.regenerate = (cb) => cb && cb();
  if (req.session && !req.session.save) req.session.save = (cb) => cb && cb();
  next();
});

app.use(flash());

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

// تهيئة قاعدة البيانات مرة واحدة لكل نسخة (تعمل عند أول طلب — مناسب لـ serverless)
let initPromise;
app.use((req, res, next) => {
  initPromise = initPromise || db.init();
  initPromise.then(() => next()).catch(next);
});

app.use('/', require('./routes/auth'));
app.use('/bookings', require('./routes/bookings'));
app.use('/calendar', require('./routes/calendar'));
app.use('/forms', require('./routes/forms'));
app.use('/reports', require('./routes/reports'));
app.use('/pricing', require('./routes/pricing'));
app.use('/users', require('./routes/users'));
app.use('/account', require('./routes/account'));
app.use('/settings', require('./routes/settings'));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('حدث خطأ في الخادم');
});

module.exports = app;

// تشغيل خادم محلي فقط (على Vercel يُستورد التطبيق بدون listen)
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`\n=================================`);
    console.log(`بيت القديسة ايلاريا - نظام الحجوزات`);
    console.log(`=================================`);
    console.log(`الخادم يعمل على المنفذ: ${PORT}`);
    console.log(`=================================\n`);
  });
}
