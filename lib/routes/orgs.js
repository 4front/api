var express = require('express');
var _ = require('lodash');
var shortid = require('shortid');
var async = require('async');
var debug = require('debug')('4front-api:orgs');

var validOrgRoles = ['admin', 'contributor', 'readonly'];

module.exports = function(options) {
  var router = express.Router();
  var hasRole = require('../middleware/has-role');
  var validateApp = require('../middleware/validate-app')(options);

  // Register middleware for handling the orgId parameter
  router.param('orgId', require('../middleware/orgid-param')(options));

  // Get the org
  router.get('/:orgId', function(req, res) {
    debug('get organization %s', req.params.orgId);
    res.json(req.ext.organization);
  });

  router.use('/:orgId/domains', require('./domains')(options));

  // Create a new org
  router.post('/', function(req, res, next) {
    var orgData = _.defaults(req.body, {
      // Default the environment pipeline to just production
      environments: ['production']
    });

    _.extend(orgData, {
      orgId: shortid.generate(),
      ownerId: req.ext.user.userId
    });

    var validationError = validateOrganization(orgData);
    if (_.isError(validationError)) {
      return next(validationError);
    }

    async.parallel([
      function(cb) {
        req.app.settings.database.createOrganization(orgData, cb);
      },
      function(cb) {
        var orgMemberData = {
          orgId: orgData.orgId,
          userId: orgData.ownerId,
          role: 'admin'
        };
        req.app.settings.database.createOrgMember(orgMemberData, cb);
      }
    ], function(err, results) {
      if (err) return next(err);

      res.status(201).json(results[0]);
    });
  });

  var createAppMiddleware = [
    hasRole('admin,contributor'),
    validateApp
  ];

  router.post('/:orgId/apps', createAppMiddleware, function(req, res, next) {
    var appData = _.extend({}, req.body, {
      ownerId: req.ext.user.userId,
      orgId: req.params.orgId,
      trafficControlEnabled: false,
      trafficRules: {}
    });

    _.defaults(appData, {
      appId: shortid.generate()
    });

    debug('Creating application ' + appData.name);

    req.app.settings.database.createApplication(appData, function(err, app) {
      if (err) return next(err);

      req.app.settings.virtualAppRegistry.add(app);
      res.status(201).json(app);
    });
  });

  // Get the count of apps belonging to this org
  router.get('/:orgId/apps/count', function(req, res, next) {
    var orgId = req.ext.organization.orgId;
    req.app.settings.database.countOrgApplications(orgId, function(err, count) {
      if (err) return next(err);

      res.json(count);
    });
  });

  // Get the list of apps belonging to this org
  router.get('/:orgId/apps', function(req, res, next) {
    debug('GET apps for org %s', req.params.orgId);

    req.app.settings.database.listOrgApplications(req.ext.organization.orgId, function(err, apps) {
      if (err) return next(err);

      apps = _.map(apps, req.app.settings.virtualAppRegistry.fixUpApp);
      res.json(apps);
    });
  });

  router.get('/:orgId/members', function(req, res, next) {
    debug('GET members of org %s' + req.ext.organization.orgId);

    async.waterfall([
      function(cb) {
        req.app.settings.database.listOrgMembers(req.ext.organization.orgId, cb);
      },
      function(members, cb) {
        debug('get org member user info');
        var userIds = _.map(members, 'userId');
        req.app.settings.database.getUserInfo(userIds, function(err, userInfo) {
          if (err) return cb(err);

          _.each(members, function(member) {
            var info = userInfo[member.userId];
            if (info) _.extend(member, info);
          });

          cb(null, members);
        });
      }
    ], function(err, members) {
      if (err) return next(err);

      res.json(_.sortBy(members, 'username'));
    });
  });

  // Add a new member to the organization
  router.post('/:orgId/members', hasRole('admin'), function(req, res, next) {
    var memberData = _.extend({}, req.body, {
      orgId: req.ext.organization.orgId
    });

    debug('adding member %s to org', memberData.username);

    var error = validateOrgMember(memberData);
    if (_.isError(error)) return next(error);

    // If there is a userId, then just try and create the org member from that
    if (memberData.userId) {
      createMember(memberData);
    } else {
      // Instead of a 4front userId, we have the provider username.
      // First check to see if this user exists.
      debug('find user with username=%s', memberData.username);
      var userQuery = _.pick(memberData, 'username', 'providerUserId');

      async.waterfall([
        function(cb) {
          req.app.settings.membership.findUser(userQuery, memberData.provider, cb);
        },
        function(user, cb) {
          if (!user) {
            req.app.settings.membership.createUser(memberData, function(err, _user) {
              if (err) return cb(err);

              memberData.userId = _user.userId;
              cb(null, memberData);
            });
          } else {
            // If the user already exists, just create the org member
            memberData.userId = user.userId;

            // Update the user's info
            req.app.settings.membership.updateProfile(memberData, function(err) {
              cb(err, memberData);
            });
          }
        }
      ], function(err) {
        if (err) return next(err);

        createMember(memberData);
      });
    }

    function createMember() {
      // Just take the attributes that are stored in the database for orgMembers.
      var actualMemberData = _.pick(memberData, 'orgId', 'userId', 'role');
      req.app.settings.database.createOrgMember(actualMemberData, function(err, member) {
        if (err) return next(err);

        res.status(201).json(member);
      });
    }
  });

  router.put('/:orgId/terminate', hasRole('admin'), function(req, res, next) {
    // Delete all the orgMembers
    async.parallel([
      function(cb) {
        req.app.settings.database.updateOrganization({
          orgId: req.ext.organization.orgId,
          activated: false,
          terminated: true,
          terminationDate: new Date(),
          terminatedBy: req.ext.user.userId
        }, cb);
      },
      function(cb) {
        req.app.settings.database.deleteOrgMembers(req.ext.organization.orgId, cb);
      }
      // TODO: Write an entry to the audit history
    ], function(err) {
      if (err) return next(err);

      res.json({message: 'Organization ' + req.ext.organization.orgId + ' terminated'});
    });
  });

  // Permanantly delete an organization.
  router.delete('/:orgId', hasRole('admin'), function(req, res, next) {
    // Delete all the orgMembers
    async.parallel([
      function(cb) {
        req.app.settings.database.deleteOrganization(req.ext.organization.orgId, cb);
      },
      function(cb) {
        req.app.settings.database.deleteOrgMembers(req.ext.organization.orgId, cb);
      }
    ], function(err) {
      if (err) return next(err);
      res.status(204).end();
    });
  });

  return router;

  function validateOrganization(orgData) {
    if (_.isEmpty(orgData.name) || orgData.name.length > 30) {
      return Error.http(400, 'Invalid organization name', {code: 'invalidOrgName'});
    }

    return null;
  }

  function validateOrgMember(member) {
    if (_.includes(validOrgRoles, member.role) !== true) {
      return Error.http(400, 'Invalid role name', {code: 'invalidRole'});
    }

    return null;
  }
};
