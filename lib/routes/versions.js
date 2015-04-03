var async = require('async');
var _ = require('lodash');
var express = require('express');
var debug = require('debug')('4front-api:versions');

require('simple-errors');

module.exports = function(options) {
  var router = express.Router();

  // Create a new version
  router.post('/', function(req, res, next) {
    if (_.isEmpty(req.body.versionId))
      return res.status(400).json({error: 'emptyVersionId'});

    var versionData = _.pick(req.body, 'versionId', 'name', 'message');

    _.extend(versionData, {
      appId: req.ext.virtualApp.appId,
      userId: req.ext.user.userId,
      // Get the name of the first environment in the pipeline. If the app has
      // overridden the organization settings use them, otherwise use the org
      // defaults.
      environment: (req.ext.virtualApp.environments || req.ext.organization.environments)[0]
    });

    if (_.isEmpty(versionData.message))
      delete versionData.message;

    var tasks = [];

    // If a version name was not sent in the header, auto-generate one
    tasks.push(function(cb) {
      options.database.nextVersionNum(versionData.appId, function(err, nextNum) {
        if (err) return cb(err);

        versionData.versionNum = nextNum;

        if (_.isEmpty(versionData.name))
          versionData.name = 'v' + nextNum;

        cb();
      });
    });

    var newVersion;
    tasks.push(function(cb) {
      debug("creating version %s in database", versionData.versionId);
      options.database.createVersion(versionData, function(err, version) {
        if (err) return cb(err);

        newVersion = version;
        debug("finished writing version to database");
        newVersion.username = req.ext.user.username;
        cb();
      });
    });

    tasks.push(function(cb) {
      var traffic = 0;

      if (req.body.forceAllTrafficToNewVersion == "1" || req.body.forceAllTrafficToNewVersion === true) {
        debug("forcing all %s traffic to new version %s", environment, versionData.versionId);
        traffic = 1;
        newVersion.previewUrl = req.ext.virtualApp.url;
      }
      else {
        traffic = 0;
        newVersion.previewUrl = req.ext.virtualApp.url + '?_version=' + newVersion.versionId;
      }

      var deployedVersions = [{versionId: newVersion.versionId, traffic: traffic}];

      options.database.updateDeployedVersions(req.ext.virtualApp.appId, versionData.environment, deployedVersions, function(err) {
        options.appRegistry.flushApp(req.ext.virtualApp);

        cb();
      });
    });

    async.series(tasks, function(err) {
      if (err) return next(err);
      return res.status(201).json(newVersion);
    });
  });

  // Get a specific version
  router.get('/:versionId', function(req, res, next) {

  });

  // Update the name and message of a version
  router.put('/:versionId', function(req, res, next) {
    // Only allow
    _.pick(req.body, 'name', 'message');

    // req.body.environment;
    // req.body.traffic;
    req.body.name
  });

  // Promote a version to the next environment in the pipeline
  // If the specified version is currently in a soft launch, promote
  // it to a full launch.
  router.post('/:versionId/promote', function(req, res, next) {
    // When promoting to production, a softLaunchPercentage can be specified
    // req.body.softLaunch;
    // req.body.softLaunchPercent;
  });

  // Rollback a version to the previous environment in the pipeline
  router.post('/:versionId/rollback', function(req, res, next) {

  });

  return router;
};
