module.exports = function requireAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'يجب تسجيل الدخول أولاً');
    return res.redirect('/login');
  }
  next();
};
