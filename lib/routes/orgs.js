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

  return router;

  function validateOrganization() {
    if (_.isEmpty(org.name))
      return "orgNameInvalid";
    if (org.name.length < 5 || org.name.length > 30)
      return "orgNameInvalid";

    return null;
  }
};
