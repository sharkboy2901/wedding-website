'use strict';

/**
 * Middleware: require admin to be logged in.
 * Redirects to /admin/login if not authenticated.
 */
function requireAdmin(req, res, next) {
  if (req.session && req.session.adminLoggedIn === true) {
    return next();
  }
  req.session.returnTo = req.originalUrl;
  res.redirect('/admin/login');
}

/**
 * Middleware: if admin already logged in, skip the login page.
 */
function redirectIfLoggedIn(req, res, next) {
  if (req.session && req.session.adminLoggedIn === true) {
    return res.redirect('/admin/dashboard');
  }
  next();
}

module.exports = { requireAdmin, redirectIfLoggedIn };
