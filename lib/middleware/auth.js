var _ = require('lodash');
var debug = require('debug')('4front-api:auth');

require('simple-errors');

module.exports = function(options) {
  // There are two ways to authenticate with the API, either with a Basic Auth header or
  // a special case where the portal is allowed same domain access with an already
  // authenticated user in session state.
  return function(req, res, next) {
    debug("authenticating API call");
    if (_.isEmpty(req.header('Authorization')) === false)
      return httpBasicAuth(req, res, next);

    // Make sure the requesting app is the portal
    // Sort of a hack, but let portal.aerobaticapp.com call the api.
    else if (/^portal(--[a-z]+|)\.aerobaticapp/.test(req.hostname) === true) {
      if (!req.session.user)
        return next(Error.http(401, "No user in session"));

      req.user = req.session.user;
      return next();
    }
    else
      return next(Error.http(403, "Invalid credentials", {code: "invalidCredentials"}));
  };

  function httpBasicAuth(req, res, next) {
    debug("Performing http basic auth");

    var authHeader = req.header('Authorization');
    var match = authHeader.match(/^Basic ([a-z0-9\+=]+)$/i);
    if (!match || match.length !== 2)
      return next(Error.http(403, "Invalid credentials", {code: "invalidCredentials"}));

    var creds;
    try {
      creds = new Buffer(match[1], 'base64').toString();
    }
    catch (e) {
      return next(Error.http(403, "Invalid credentials", {code: "invalidCredentials"}));
    }

    // The header is a base64 encoded string in the form userId:secretKey
    creds = creds.split(':');
    if (creds.length !== 2)
      return next(Error.http(403, "Invalid base64 auth header"));

    var userId = creds[0];
    var secretKey = creds[1];

    // Get the user with the specified userId and ensure the secretKey matches.
    req.app.settings.database.getUser(userId, function(err, user) {
      if (err) return next(err);
      if (!user) return next(Error.http(401, "User not found"));

      if (user.secretKey !== secretKey) {
        debug("secret keys do not match");
        return next(Error.http(401, "Invalid credentials", {code: "invalidCredentials"}));
      }

      debug("basic auth successful");
      user.isAuthenticated = true;
      req.ext.user = user;

      next();
    });
  }
}
