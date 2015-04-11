var async = require('async');
var _ = require('lodash');
var express = require('express');
var hasRole = require('../middleware/has-role');
var debug = require('debug')('4front-api:versions');

require('simple-errors');

module.exports = function(options) {
  var router = express.Router();

  // Create a new version
  router.post('/', hasRole('contributor,admin'), function(req, res, next) {
    if (_.isEmpty(req.body.versionId))
      return res.status(400).json({error: 'emptyVersionId'});

    // Get the name of the first environment in the pipeline. If the app has
    // overridden the organization settings use them, otherwise use the org
    // defaults.
    var environments = req.ext.organization ?
      req.ext.organization.environments : req.ext.virtualApp.environments;

    if (_.isEmpty(environments))
      return next(Error.http(400, "No environments configured", {code: "noEnvironmentsExist"}));

    // Deployments are done to the first environment in the pipeline. Promotion to subsequent
    // environments entails updating the traffic rules for those envs.
    var environment = environments[0];

    var versionData = _.pick(req.body, 'versionId', 'name', 'message');

    _.extend(versionData, {
      appId: req.ext.virtualApp.appId,
      userId: req.ext.user.userId
    });

    if (_.isEmpty(versionData.message))
      delete versionData.message;

    var tasks = [];

    // If a version name was not sent in the header, auto-generate one
    tasks.push(function(cb) {
      req.app.settings.database.nextVersionNum(versionData.appId, function(err, nextNum) {
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
      req.app.settings.database.createVersion(versionData, function(err, version) {
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
        newVersion.previewUrl = req.ext.virtualApp.url;
        var trafficRules = [{versionId: newVersion.versionId, rule: "*"}];

        req.app.settings.database.updateTrafficRules(req.ext.virtualApp.appId, environment, trafficRules, function(err) {
          if (err) return cb(err);

          req.app.settings.virtualAppRegistry.flushApp(req.ext.virtualApp);
          cb();
        });
      }
      else {
        newVersion.previewUrl = req.ext.virtualApp.url + '?_version=' + newVersion.versionId;
        cb();
      }
    });

    async.series(tasks, function(err) {
      if (err) return next(err);
      return res.status(201).json(newVersion);
    });
  });

  // Get a specific version
  router.get('/:versionId', function(req, res, next) {
    req.app.settings.database.getVersion(req.ext.virtualApp.appId, req.params.versionId, function(err, version) {
      if (err) return next(err);

      if (!version)
        return next(Error.http(404, "Version " + req.params.versionId + " not found", {code: "versionNotFound"}));

      res.json(version);
    });
  });

  // List versions
  router.get('/', function(req, res, next) {
    req.app.settings.database.listVersions(req.ext.virtualApp.appId, req.query.limit || 20, function(err, versions) {
      if (err) return next(err);

      // Get the list of unique userIds from the versions
      var userIds = _.uniq(_.compact(_.map(versions, 'userId')));

      // Get the username for each version
      req.app.settings.database.getUserInfo(userIds, function(err, userInfoMap) {
        if (err) return next(err);

        _.each(versions, function(version) {
          var userInfo = userInfoMap[version.userId];
          if (userInfo)
            _.extend(version, _.pick(userInfo, 'username', 'avatar'));
        });

        versions = _.sortBy(versions, 'created').reverse();
        res.json(versions);
      });
    });
  });

  // Update the name and message of a version
  router.put('/:versionId', hasRole('admin,contributor'), function(req, res, next) {
    var versionData = _.pick(req.body, 'name', 'message');
    versionData.versionId = req.params.versionId;

    req.app.settings.database.updateVersion(versionData, function(err, version) {
      if (err) return next(err);

      res.json(version);
    });
  });

  // Delete a version
  router.delete('/:versionId', hasRole('admin'), function(req, res, next) {
    // Get the version object
    req.app.settings.database.getVersion(req.ext.virtualApp.appId, req.params.versionId, function(err, version) {
      // Ensure the appId in the URL matches the appId of the version.
      if (!version)
        return next(Error.http(404, "Version " + req.params.versionId + " does not exist", {code: "versionNotFound"}));

      async.parallel([
        function(cb) {
          req.app.settings.database.deleteVersion(req.ext.virtualApp.appId, req.params.versionId, cb);
        },
        function(cb) {
          req.app.settings.deployments.deleteVersion(req.ext.virtualApp.appId, req.params.versionId, cb);
        }
      ], function(err) {
        if (err) return next(err);
        res.status(204).json({message: "version deleted"});
      });
    });
  });

  return router;
};
