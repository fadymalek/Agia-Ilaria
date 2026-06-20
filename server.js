const express = require('express');
const session = require('express-session');
const flash = require('connect-flash');
const methodOverride = require('method-override');
const path = require('path');

require('./db');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(methodOverride('_method'));

app.use(session({
  secret: 'hilaria-2024-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }
}));

app.use(flash());

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  next();
});

app.use('/', require('./routes/auth'));
app.use('/bookings', require('./routes/bookings'));
app.use('/forms', require('./routes/forms'));
app.use('/reports', require('./routes/reports'));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('حدث خطأ في الخادم');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n=================================`);
  console.log(`بيت القديسة ايلاريا - نظام الحجوزات`);
  console.log(`=================================`);
  console.log(`الرابط: http://localhost:${PORT}`);
  console.log(`المستخدم: admin`);
  console.log(`كلمة السر: admin123`);
  console.log(`=================================\n`);
});
