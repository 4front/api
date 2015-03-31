var debug = require('debug')('4front-api:appid-param');
var _ = require('lodash');

require('simple-errors');

// parameter middleware for the orgId param
module.exports = function(options) {
  return function(req, res, next, orgId) {
    debug("parsing orgId parameter");

    var lookupOptions = _.extend({}, req.app.settings, {
      bypassCache: req.query.nocache === '1'
    });

    options.database.getOrganization(orgId, function(err, org) {
      if (err) return next(err);

      if (!org) {
        debug("Could not find org %s", req.params.orgId);
        return next(Error.http(404, "Could not find organization " + req.params.orgId, {code: "orgNotFound"}));
      }

      req.ext.organization = org;

      options.database.getOrgMember(org.orgId, req.ext.user.userId, function(err, orgMember) {
        if (err) return next(err);

        if (!orgMember)
          return next(Error.http(401, "User is not a member of org", {code: "userNotOrgMember"}));

        req.ext.orgMember = orgMember;
        next();
      });
    });
  };
};
