var debug = require('debug')('4front-api:orgid-param');

require('simple-errors');

// parameter middleware for the orgId param
module.exports = function() {
  return function(req, res, next, orgId) {
    debug('parsing orgId parameter');

    req.app.settings.database.getOrganization(orgId, function(err, org) {
      if (err) return next(err);

      if (!org) {
        debug('Could not find org %s', req.params.orgId);
        return next(Error.http(404, 'Could not find organization '
          + req.params.orgId, {code: 'orgNotFound'}));
      }

      req.ext.organization = org;
      var userId = req.ext.user.userId;

      req.app.settings.database.getOrgMember(org.orgId, userId, function(_err, orgMember) {
        if (_err) return next(_err);

        if (!orgMember) {
          return next(Error.http(401, 'User is not a member of org', {
            userId: userId,
            orgId: org.orgId,
            code: 'userNotOrgMember'
          }));
        }

        req.ext.orgMember = orgMember;
        next();
      });
    });
  };
};
