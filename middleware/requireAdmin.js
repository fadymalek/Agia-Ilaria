// يسمح فقط للمستخدمين أصحاب صلاحية "مسؤول"
module.exports = function requireAdmin(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'يجب تسجيل الدخول أولاً');
    return res.redirect('/login');
  }
  if (req.session.user.role !== 'admin') {
    req.flash('error', 'هذه الصفحة متاحة للمسؤول فقط');
    return res.redirect('/bookings');
  }
  next();
};
