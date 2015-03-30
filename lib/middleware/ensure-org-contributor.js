var debug = require('debug')('4front-api:ensure-org-member');

// Middleware function for new app creation API call.
module.exports = function(options) {
  return function(req, res, next) {
    // Once personal apps are deprecated, get rid of this.
    if (!req.body.orgId)
      return next();

    options.orgLookup(req.body.orgId, req.app.settings, function(err, org) {
      if (err) return next(err);

      if (!org)
        return next(Error.http(400, "Invalid orgId " + req.body.orgId));

      req.ext.organization = org;
      options.database.getOrgMember(org.orgId, req.user.userId, function(err, orgMember) {
        if (err) return next(err);

        if (!orgMember || _.contains(['admin','contributor'], orgMember.role) === false) {
          debug("User is not an admin or contributor of the org");
          return res.status(401).json({error: "User is not an admin or contributor of the org."});
        }

        req.ext.orgMember = orgMember;
        next();
      });
    });
  };
};
