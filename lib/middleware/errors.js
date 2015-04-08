var _ = require('lodash');
var debug = require('debug')('4front-api:errors');

require('simple-errors');

// Error handler for the API
module.exports = function(err, req, res, next) {
  if (!err.status)
    err.status = 500;

  req.app.settings.logger.error(err, req);

  // Omit the stack from the error json that is sent back in the response.
  res.status(err.status).json(_.omit(Error.toJson(err), 'stack'));
};
