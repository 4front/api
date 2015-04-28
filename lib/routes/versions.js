var async = require('async');
var _ = require('lodash');
var shortid = require('shortid');
var express = require('express');
var through = require('through2');
var bodyParser = require('body-parser');
var hasRole = require('../middleware/has-role');
var debug = require('debug')('4front-api:versions');

require('simple-errors');

module.exports = function(options) {
  var router = express.Router();

  // Create a new version
  router.post('/', [hasRole('contributor,admin'), bodyParser.json()], function(req, res, next) {
    var versionData = _.pick(req.body, 'versionId', 'name', 'message');

    _.extend(versionData, {
      versionId: shortid.generate(),
      appId: req.ext.virtualApp.appId,
      userId: req.ext.user.userId,
      // Versions are not active initially. A second api call to /activate is required
      // to flip the active flag to true.
      active: false
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

    async.series(tasks, function(err) {
      if (err) return next(err);
      return res.status(201).json(newVersion);
    });
  });

  // Activate a version
  router.put('/:versionId/activate', [hasRole('contributor,admin'), bodyParser.json()], function(req, res, next) {
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

    req.app.settings.database.updateVersion({
      appId: req.ext.virtualApp.appId,
      versionId: req.params.versionId,
      active: true
    }, function(err, version) {
      if (err) return next(err);

      if (req.body.forceAllTrafficToNewVersion !== true) {
        //TODO: Need to incorporate the environment name into the preview URL.
        version.previewUrl = req.ext.virtualApp.url + '?_version=' + version.versionId;
        return res.json(version);
      }

      debug("forcing all %s traffic to new version %s", environment, version.versionId);
      version.previewUrl = req.ext.virtualApp.url;

      var trafficRules = [{versionId: version.versionId, rule: "*"}];
      req.app.settings.database.updateTrafficRules(req.ext.virtualApp.appId, environment, trafficRules, function(err) {
        if (err) return next(err);

        req.app.settings.virtualAppRegistry.flushApp(req.ext.virtualApp);
        res.status(200).json(version);
      });
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
  router.put('/:versionId', [hasRole('admin,contributor'), bodyParser.json()], function(req, res, next) {
    var versionData = _.pick(req.body, 'name', 'message');
    versionData.versionId = req.params.versionId;

    req.app.settings.database.updateVersion(versionData, function(err, version) {
      if (err) return next(err);

      res.json(version);
    });
  });

  // Deploy a file to a specific version
  router.post('/:versionId/deploy/*', hasRole('admin,contributor'), function(req, res, next) {
    var pathParts = req.originalUrl.split('/');
    var filePath = _.slice(pathParts, pathParts.indexOf('deploy') + 1).join('/');

    debug('deploying file %s', filePath);

    var fileInfo = {
      path: filePath,
      // Pipe through passthrough stream as setting req.storage.blob to req directly
      // doesn't work.
      contents: req.pipe(through(function(chunk, enc, callback) {
        this.push(chunk);
        callback();
      })),
      size: req.header('content-length')
    };

    if (req.header('content-type') === 'application/gzip')
      fileInfo.gzipEncoded = true;

    req.app.settings.deployments.deployFile(req.ext.virtualApp.appId, req.params.versionId, fileInfo, function(err) {
      if (err) return next(err);

      res.status(201).json({key: fileInfo.path});
    })
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
