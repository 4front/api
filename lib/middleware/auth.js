var _ = require('lodash');
var jwt = require('jwt-simple');
var debug = require('debug')('4front-api:auth');

require('simple-errors');

module.exports = function(options) {
  // There are two ways to authenticate with the API, either with a Basic Auth header or
  // a special case where the portal is allowed same domain access with an already
  // authenticated user in session state.
  return function(req, res, next) {

    // Special exception for the login API call which is the only one that
    // doesn't require authentication.
    if (req.path === '/profile/login')
      return next();

    debug("authenticating API call with JWT");

    var accessTokenHeader = req.header('X-Access-Token');
    if (_.isEmpty(accessTokenHeader))
      return next(Error.http(401, "Not authenticated", {code: "notAuthenticated"}));

    debugger;
    var accessToken;
    try {
      accessToken = jwt.decode(accessTokenHeader, req.app.get('jwtTokenSecret'));
    } catch (err) {
      return next(Error.http(401, "Not authenticated", {code: "notAuthenticated"}));
    }

    if (accessToken.exp <= Date.now()) {
      return next(Error.http(401, "Not authenticated", {code: "notAuthenticated"}));
    }

    var userId = accessToken.iss;

    req.app.settings.database.getUser(userId, function(err, user) {
      if (err) return next(err);
      if (!user) return next(Error.http(401, "User " + userId + " not found", {code: "invalidUser"}));

      debug("access token is valid");
      user.isAuthenticated = true;
      req.ext.user = user;

      next();
    });
  }
}
