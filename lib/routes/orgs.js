var express = require('express');
var _ = require('lodash');
var shortid = require('shortid');
var async = require('async');
var moment = require('moment');
var bodyParser = require('body-parser');
var debug = require('debug')('4front-api:orgs');

var validOrgRoles = ['admin', 'contributor', 'readonly'];

module.exports = function(options) {
  var router = express.Router();
  var hasRole = require('../middleware/has-role');

  // Register middleware for handling the orgId parameter
  router.param('orgId', require('../middleware/orgid-param')(options));

  // Get the org
  router.get('/:orgId', function(req, res, next) {
    debug("get organization %s", req.params.orgId);
    res.json(req.ext.organization);
  });

  router.post('/', bodyParser.json(), function(req, res, next) {
    var orgData = _.defaults(req.body, {
      plan: 'unlimited',
      // Default the environment pipeline to just production
      environments: ['production']
    });

    _.extend(orgData, {
      orgId: shortid.generate(),
      ownerId: req.ext.user.userId
    });

    // If there are no paidOrgPlans, just offer an unlimited one
    _.defaults(req.app.settings, {
      orgPlans: {
        unlimited: { price: 0, operationLimit: 0}
      }
    });

    var planInfo = req.app.settings.orgPlans[orgData.plan];
    if (!planInfo)
      return next(Error.http(400, "Invalid plan name", {code: 'invalidPlanName', plan: orgData.plan}));

    // Verify that the user has not already used up their trial
    if (orgData.plan === 'trial' && req.ext.user.usedTrialOrg === true)
      return next(Error.http(400, "User already used up trial org", {code: 'userAlreadyUsedTrial'}));

    if (orgData.plan === 'trial') {
      _.extend(orgData, {
        trialStart: moment().format('YYYY-MM-DD'),
        trialEnd: moment().add(planInfo.duration, 'days').format('YYYY-MM-DD'),
        monthlyRate: planInfo.price,
        activated: false
      });
    }
    else {
      orgData.activated = true;
    }

    orgData.operationLimit = planInfo.operationLimit;

    var validationError = validateOrganization(orgData);
    if (_.isError(validationError))
      return next(validationError);

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

      // If this is a trial plan, indicate that this user has
      // used up their one trial.
      if (orgData.plan === 'trial') {
        req.ext.user.usedTrialOrg = true;
        req.app.settings.membership.updateProfile(req.ext.user, function(err) {
          if (err) return next(err);

          res.status(201).json(results[0]);
        });
      }
      else {
        res.status(201).json(results[0]);
      }
    });
  });

  // Get the list of apps belonging to this org
  router.get('/:orgId/apps', function(req, res, next) {
    debug("GET apps for org %s", req.params.orgId);

    req.app.settings.database.listOrgAppIds(req.ext.organization.orgId, function(err, appIds) {
      if (err) return next(err);

      req.app.settings.virtualAppRegistry.batchGetById(appIds, function(err, apps) {
        if (err) return next(err);

        res.json(apps);
      });
    });
  });

  router.get('/:orgId/members', function(req, res, next) {
    debug("GET members of org %s" + req.ext.organization.orgId);
    req.app.settings.database.listOrgMembers(req.ext.organization.orgId, function(err, members) {
      if (err) return next(err);

      debug("get org member user info");
      var userIds = _.map(members, 'userId');
      req.app.settings.database.getUserInfo(userIds, function(err, userInfo) {
        if (err) return next(err);

        _.each(members, function(member) {
          var info = userInfo[member.userId];
          if (info)
            _.extend(member, info);
        });

        res.json(_.sortBy(members, 'username'));
      });
    });
  });

  // Add a new member to the organization
  router.post('/:orgId/members', [bodyParser.json(), hasRole('admin')], function(req, res, next) {
    var memberData = _.extend({}, req.body, {
      orgId: req.ext.organization.orgId
    });

    debug("adding member %s to org", memberData.username);

    var error = validateOrgMember(memberData);
    if (_.isError(error))
      return next(error);

    // If there is a userId, then just try and create the org member from that
    if (memberData.userId) {
      createMember(memberData);
    }
    // Instead of a 4front userId, we have the providerUserId.
    else {
      // First check to see if this user exists.
      debug("find user with providerUserId=%s", memberData.providerUserId);
      req.app.settings.membership.findUser(memberData.providerUserId, memberData.provider, function(err, user) {
        if (err) return next(err);

        if (!user) {
          req.app.settings.membership.createUser(memberData, function(err, user) {
            if (err) return next(err);

            memberData.userId = user.userId;
            createMember(memberData);
          });
        }
        // If the user already exists, just create the org member
        else {
          memberData.userId = user.userId;

          // Update the user's avatar
          req.app.settings.membership.updateProfile({userId: user.userId, avatar: memberData.avatar, username: memberData.username}, function(err) {
            if (err) return next(err);
            createMember(memberData);
          });
        }
      });
    }

    function createMember(memberData) {
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

      res.json({message: "Organization " + req.ext.organization.orgId + " terminated"});
    });
  });

  return router;

  function validateOrganization(orgData) {
    if (_.isEmpty(orgData.name) || orgData.name.length < 5 || orgData.name.length > 30)
      return Error.http(400, "Invalid organization name", {code: "invalidOrgName"});

    return null;
  }

  function validateOrgMember(member) {
    if (_.contains(validOrgRoles, member.role) !== true)
      return Error.http(400, "Invalid role name", {code: "invalidRole"});

    return null;
  }
};
