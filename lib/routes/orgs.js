var express = require('express');
var _ = require('lodash');
var shortid = require('shortid');
var async = require('async');
var debug = require('debug')('4front-api:orgs');

var validOrgRoles = ['admin', 'contributor', 'readonly'];

module.exports = function(options) {
  var router = express.Router();
  var hasRole = require('../middleware/has-role');

  // If there are no paidOrgPlans, just offer an unlimited one
  _.defaults(options, {
    paidOrgPlans: {
      unlimited: { price: 0, operations: 0}
    }
  });

  // Register middleware for handling the orgId parameter
  router.param('orgId', require('../middleware/orgid-param')(options));

  // Get the org
  router.get('/:orgId', function(req, res, next) {
    debug("get organization %s", req.params.orgId);
    res.json(req.ext.organization);
  });

  router.post('/', function(req, res, next) {
    var orgData = _.defaults(req.body, {
      plan: 'unlimited'
    });

    _.extend(orgData, {
      orgId: shortid.generate(),
      ownerId: req.ext.user.userId
    });

    var planInfo = orgPlans[orgData.plan];
    if (!planInfo)
      return res.status(400).json({error: 'invalidPlanName', plan: orgData.plan});

    // Verify that the user has not already used up their trial
    if (orgData.plan === 'trial' && req.ext.user.usedTrialOrg === true)
      return res.status(400).json({error: 'userAlreadyUsedTrial'});

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
    if (_.isEmpty(validationError) === false)
      return res.status(400).json({error: validationError});

    async.parallel([
      function(cb) {
        options.database.createOrganization(orgData, cb);
      },
      function(cb) {
        var orgMemberData = {
          orgId: orgData.orgId,
          userId: orgData.ownerId,
          role: 'admin',
          accessKey: randomstring.generate()
        };
        options.database.createOrgMember(orgMemberData, cb);
      }
    ], function(err, results) {
      if (err) return next(err);

      // If this is a trial plan, indicate that this user has
      // used up their one trial.
      if (orgData.plan === 'trial') {
        req.ext.user.usedTrialOrg = true;
        options.database.updateUser(req.user, function(err) {
          if (err) return next(err);

          res.status(201).json(results[0]);
        });
      }
      else {
        res.status(201).json(results[0]);
      }
    });
  });

  router.get('/:orgId/members', function(req, res, next) {
    debug("GET members of org %s" + req.ext.organization.orgId);
    options.database.listOrgMembers(req.ext.organization.orgId, function(err, members) {
      if (err) return next(err);

      debug("get org member user info");
      var userIds = _.map(members, 'userId');
      options.database.getUserInfo(userIds, function(err, userInfo) {
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
  router.post('/:orgId/members', hasRole('admin'), function(req, res, next) {
    var memberData = _.extend({}, req.body, {
      orgId: req.ext.organization.orgId
    });

    debug("adding member %s to org", memberData.username);

    var error = validateOrgMember(memberData);
    if (error)
      return res.status(400).json({error: error});

    // If there is a userId, then just try and create the org member from that
    if (memberData.userId) {
      createMember(memberData);
    }
    // Instead of an Aerobatic userId, we have a GitHub user id.
    else {
      // First check to see if this user exists.
      debug("find user with providerUserId=%s", memberData.providerUserId);
      options.database.findUser(memberData.providerUserId, memberData.provider, function(err, user) {
        if (err) return next(err);

        if (!user) {
          var userData = _.pick(memberData, 'providerUserId', 'provider', 'avatar', 'username');

          // Ensure the GitHub user id is a string.
          userData.providerUserId = userData.providerUserId.toString();
          userData.userId = shortid.generate();

          options.database.createUser(userData, function(err, user) {
            if (err) return next(err);

            memberData.userId = user.userId;
            createMember(memberData);
          });
        }
        // If the user already exists, just create the org member
        else {
          memberData.userId = user.userId;

          // Update the user's avatar
          if (memberData.avatar) {
            options.database.updateUser({userId: user.userId, avatar: memberData.avatar, username: memberData.username}, function(err) {
              if (err) return next(err);
              createMember(memberData);
            });
          }
          else {
            createMember(memberData);
          }
        }
      });
    }

    function createMember(memberData) {
      // Just take the attributes that are stored in the database for orgMembers.
      var actualMemberData = _.pick(memberData, 'orgId', 'userId', 'role');
      options.database.createOrgMember(actualMemberData, function(err, member) {
        if (err) return next(err);

        res.status(201).json(member);
      });
    }
  });


  return router;

  function validateOrganization() {
    if (_.isEmpty(org.name))
      return "orgNameInvalid";
    if (org.name.length < 5 || org.name.length > 30)
      return "orgNameInvalid";

    return null;
  }

  function validateOrgMember(member) {
    if (_.contains(validOrgRoles, member.role) !== true)
      return "invalidRole";

    return null;
  }
};
