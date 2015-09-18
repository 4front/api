var async = require('async');
var _ = require('lodash');
var debug = require('debug')('4front-api:appid-param');

require('simple-errors');

// Middleware that loads the application based on the appId parameter and
// verifies that the current user has access to that app.
module.exports = function() {
  return function(req, res, next, appId) {
    debug("Parsing appId parameter");

    var opts = {forceReload: req.query.nocache === '1'};
    req.app.settings.virtualAppRegistry.getById(appId, opts, function(err, virtualApp) {
      if (err) return next(err);

      if (!virtualApp) {
        debug("Could not find app %s", req.params.appId);
        return next(Error.http(404, "Could not find application " + req.params.appId, {
          code: "appNotFound"
        }));
      }

      req.ext.virtualApp = virtualApp;

      // Load the organization and orgMember in parallel
      async.parallel({
        organization: function(cb) {
          req.app.settings.database.getOrganization(virtualApp.orgId, cb);
        },
        orgMember: function(cb) {
          req.app.settings.database.getOrgMember(virtualApp.orgId, req.ext.user.userId, cb);
        }
      }, function(_err, results) {
        if (_err) return next(_err);

        if (!results.orgMember) {
          debug("User %s is not a member of organization %s",
            req.ext.user.userId, virtualApp.orgId);

          return next(Error.http(401, "User is not a member of the app's organization", {
            code: "userNotOrgMember"
          }));
        }

        _.extend(req.ext, results);
        next();
      });
    });
  };
};
