var debug = require('debug')('4front-api:ensure-org-member');

// Middleware function for new app creation API call.
module.exports = function(options) {
  return function(req, res, next) {
    // Once personal apps are deprecated, get rid of this.
    if (!req.body.orgMember)
      return next();

    if (!req.ext.orgMember)
      return next(new Error("req.ext.organization is null"));

      if (_.contains(['admin','contributor'], req.ext.orgMember.role) === false)
        return next(Error.http(401, "User is not an admin or contributor of the org.", code: "userNotOrgContributor"});

      next();
    });
  };
};
