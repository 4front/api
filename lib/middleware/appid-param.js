var debug = require('debug')('4front-api:appid-param');
var _ = require('lodash');

require('simple-errors');

// Middleware that loads the application based on the appId parameter and
// verifies that the current user has access to that app.
module.exports = function(options) {
  return function(req, res, next, appId) {
    debug("Parsing appId parameter");

    options.appRegistry.getById(appId, {forceReload: req.query.nocache == '1'}, function(err, virtualApp) {
      if (err) return next(err);

      if (!virtualApp) {
        debug("Could not find app %s", req.params.appId);
        return next(Error.http(404, "Could not find application " + req.params.appId, {code: "appNotFound"}));
      }

      req.ext.virtualApp = virtualApp;

      if (virtualApp.orgId) {
        debug("ensure user %s is member of org %s", req.ext.user.userId, virtualApp.orgId);
        options.database.getOrgMember(virtualApp.orgId, req.ext.user.userId, function(err, orgMember) {
          if (err) return next(err);

          if (!orgMember) {
            debug("User %s is not a member of organization %s", req.ext.user.userId, virtualApp.orgId);
            return next(Error.http(401, "User is not a member of the app's organization", {code:"userNotOrgMember"}));
          }

          req.ext.orgId = virtualApp.orgId;
          req.ext.orgMember = orgMember;

          next();
        });
      }
      else {
        if (virtualApp.ownerId !== req.user.userId)
          return res.status(401).json({error: "User is not the owner of this application"});

        return next();
      }
    });
  };
};
