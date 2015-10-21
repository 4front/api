
var exports = {};

exports.domainManager = function(req, res, next) {
  if (!req.app.settings.domains) {
    return next(new Error('No domain registrar configured on the 4front application'));
  }
  next();
};

module.exports = exports;
