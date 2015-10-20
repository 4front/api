var _ = require('lodash');
var debug = require('debug')('4front-api:has-role');

require('simple-errors');

// Middleware function to validate that the current user has one of a specified set of roles.
module.exports = function(roles) {
  return function(req, res, next) {
    debug('executing');

    if (_.isString(roles)) {
      roles = roles.split(',');
    }

    if (!req.ext.orgMember) {
      return next(Error.http(401, 'User is not a member of the organization'));
    }

    debug('verify user with role %s has one of the roles: %s',
      req.ext.orgMember.role, JSON.stringify(roles));

    if (!_.include(roles, req.ext.orgMember.role)) {
      return next(Error.http(401, 'User lacks required role.', {
        requiredRole: roles, code: 'lackRequiredRole'
      }));
    }

    next();
  };
};
