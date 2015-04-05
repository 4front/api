var _ = require('lodash');
var debug = require('debug')('4front-api:errors');

require('simple-errors');

// Error handler for the API
module.exports = function(err, req, res, next) {
  if (!err.status)
    err.status = 500;

  debugger;

  var errorJson = Error.toJson(err);

  // Per 12 factor auth guidelines, errors should just be streamed to stderr.
  // http://12factor.net/logs
  if (err.status >= 500) {
    debug(err.stack || err.toString());

    console.error(JSON.stringify(errorJson));
  }

  // Omit the stack from the error json that is sent back in the response.
  res.status(err.status).json(_.omit(errorJson, 'stack'));
};
