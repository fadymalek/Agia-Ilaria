# دليل النشر — بيت القديسة ايلاريا (مجاني)

النظام بقى يستخدم قاعدة بيانات **Postgres** بدل ملف JSON، عشان البيانات تفضل محفوظة بشكل دائم.
الخطة المجانية المقترحة: استضافة على **Render** + قاعدة بيانات **Neon Postgres** (مجانية ودائمة).

---

## الخطوة 1: إنشاء قاعدة بيانات Postgres مجانية على Neon

1. ادخل على https://neon.tech وسجّل بحساب GitHub أو Google.
2. اضغط **Create Project** واختار أقرب منطقة (مثلاً Frankfurt / EU).
3. بعد الإنشاء هيظهرلك **Connection String** بالشكل ده:
   ```
   postgresql://user:password@ep-xxxx.eu-central-1.aws.neon.tech/dbname?sslmode=require
   ```
4. انسخ الرابط ده — هنحطه في Render باسم `DATABASE_URL`.

---

## الخطوة 2: رفع الكود على GitHub

الكود موجود أصلاً على: https://github.com/fadymalek/Agia-Ilaria.git
تأكد إنك عملت push لآخر التعديلات:
```bash
git add .
git commit -m "تحويل التخزين إلى Postgres وتجهيز النشر"
git push
```

---

## الخطوة 3: النشر على Render

1. ادخل على https://render.com وسجّل بحساب GitHub.
2. اضغط **New +** ثم **Web Service**.
3. اختار ريبو `Agia-Ilaria`.
4. الإعدادات:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Plan:** Free
5. تحت **Environment Variables** أضف:
   | المفتاح | القيمة |
   |---------|--------|
   | `DATABASE_URL` | رابط Neon اللي نسخته |
   | `SESSION_SECRET` | أي نص عشوائي طويل |
   | `ADMIN_PASSWORD` | كلمة سر المسؤول الأولى |
   | `NODE_ENV` | `production` |
6. اضغط **Create Web Service** وانتظر انتهاء البناء.
7. النظام هينشئ الجداول وحساب `admin` تلقائياً عند أول تشغيل.

> ملاحظة: الخطة المجانية في Render بتنام الخدمة بعد ١٥ دقيقة خمول، وأول طلب بعدها بياخد ٢٠–٣٠ ثانية تقريباً عشان تصحى. البيانات نفسها مش بتضيع لأنها في Neon.

---

## بيانات الدخول الأولى

- المستخدم: `admin`
- كلمة المرور: القيمة اللي حطيتها في `ADMIN_PASSWORD` (أو `admin123` لو سِبتها فاضية).

**مهم:** غيّر كلمة السر بعد أول دخول لو هتضيف ميزة تغيير كلمة السر لاحقاً.

---

## مناسب للموبايل ✅

الواجهة متجاوبة بالكامل (Bootstrap 5 RTL + viewport meta + جداول قابلة للتمرير على الشاشات الصغيرة)،
وتشتغل تمام على الموبايل من غير أي إعداد إضافي.
