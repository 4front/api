var async = require('async');
var _ = require('lodash');
var express = require('express');
var through = require('through2');
var bodyParser = require('body-parser');
var hasRole = require('../middleware/has-role');
var debug = require('debug')('4front:api:versions');

require('simple-errors');

module.exports = function() {
  var router = express.Router();

  // Deploy a file to a specific version
  router.post('/:versionId/deploy/*', hasRole('admin,contributor'), function(req, res, next) {
    var pathParts = req.originalUrl.split('/');
    var filePath = _.slice(pathParts, pathParts.indexOf('deploy') + 1).join('/');
    var appId = req.ext.virtualApp.appId;
    var versionId = req.params.versionId;

    debug('deploying file %s', filePath);

    var fileInfo = {
      path: filePath,
      // Pipe through passthrough stream as setting req.storage.blob to req directly
      // doesn't work.
      contents: req.pipe(through(function(chunk, enc, callback) {
        this.push(chunk);
        callback();
      })),
      size: parseInt(req.header('content-length'), 10)
    };

    if (req.header('content-type') === 'application/gzip') {
      fileInfo.gzipEncoded = true;
    }

    req.app.settings.deployer.deploy(appId, versionId, fileInfo, function(err) {
      if (err) return next(err);

      res.status(201).json({filePath: fileInfo.path});
    });
  });

  router.use(bodyParser.json());

  // Get a specific version
  router.get('/:versionId', function(req, res, next) {
    var appId = req.ext.virtualApp.appId;
    var versionId = req.params.versionId;

    req.app.settings.database.getVersion(appId, versionId, function(err, version) {
      if (err) return next(err);

      if (!version) {
        return next(Error.http(404, 'Version ' + versionId + ' not found',
          {code: 'versionNotFound'}));
      }

      res.json(version);
    });
  });

  // List versions
  router.get('/', function(req, res, next) {
    var options = {limit: req.query.limit || 20, excludeIncomplete: false};
    var trafficRules = req.ext.virtualApp.trafficRules || {};
    var appId = req.ext.virtualApp.appId;

    var versions;
    async.series([
      function(cb) {
        req.app.settings.database.listVersions(appId, options, function(err, data) {
          if (err) return cb(err);
          versions = data;
          cb();
        });
      },
      function(cb) {
        // Mark any versions in the initiated phase that are more than 5 minutes
        // old as failed with an error of "timed out".
        // Keep the version if it is less than 5 minutes old
        var timedOutVersions = _.filter(versions, function(version) {
          return version.status === 'initiated' &&
            (Date.now() - new Date(version.created).getTime()) / 1000 > 300;
        });

        if (timedOutVersions.length === 0) return cb();

        async.each(timedOutVersions, function(version, done) {
          version.status = 'failed';
          version.error = 'Deployment timed out';

          req.app.settings.deployer.versions.updateStatus(version, req.ext, {}, done);
        }, cb);
      },
      function(cb) {
        // Get the list of unique userIds from the versions
        var userIds = _.uniq(_.compact(_.map(versions, 'userId')));

        // Get the username for each version
        req.app.settings.database.getUserInfo(userIds, function(err, userInfoMap) {
          if (err) return cb(err);

          _.each(versions, function(version) {
            var userInfo = userInfoMap[version.userId];
            if (userInfo) _.extend(version, _.pick(userInfo, 'username', 'avatar'));

            // Invert the app's traffic rules to be version specific
            version.trafficRules = [];
            _.each(trafficRules, function(ruleList, envName) {
              var matchingRule = _.find(ruleList, {versionId: version.versionId});

              if (matchingRule) {
                version.trafficRules.push({
                  envName: envName === 'prod' ? 'production' : envName,
                  rule: matchingRule.rule,
                  url: req.ext.virtualApp.urls[envName] || req.ext.virtualApp.url
                });
              }
            });
          });

          versions = _.sortBy(versions, 'created').reverse();

          cb();
        });
      }
    ], function(err) {
      if (err) return next(err);

      res.json(versions);
    });
  });

  // Create a new version
  router.post('/', hasRole('contributor,admin'), function(req, res, next) {
    req.app.settings.deployer.versions.create(req.body, req.ext, function(err, version) {
      if (err) return next(err);
      return res.status(201).json(version);
    });
  });

  // Mark a version as complete
  router.put('/:versionId/complete', hasRole('contributor,admin'), function(req, res, next) {
    var versionData = {
      versionId: req.params.versionId,
      status: 'complete'
    };

    req.app.settings.deployer.versions.updateStatus(
      versionData, req.ext, req.body, function(err, version) {
        if (err) return next(err);
        res.status(200).json(version);
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


  // Push the specified version to an environment
  router.post('/:versionId/push/:envName', hasRole('admin'), function(req, res, next) {
    var appId = req.ext.virtualApp.appId;
    var asyncTasks = [];

    // Find any existing rules for this version.
    if (req.body.deleteOtherEnvRules === true) {
      // Get the traffic rules for all the other environments
      var trafficRules = _.omit(req.ext.virtualApp.trafficRules, req.params.envName);

      _.each(trafficRules, function(rules, envName) {
        var remainingRules = _.reject(rules, {versionId: req.params.versionId});
        if (remainingRules.length < rules.length) {
          asyncTasks.push(function(cb) {
            if (remainingRules.length === 0) {
              req.app.settings.database.deleteTrafficRules(appId, envName, cb);
            } else {
              req.app.settings.database.updateTrafficRules(appId, envName, remainingRules, cb);
            }
          });
        }
      });
    }

    // Create rule forcing all traffic for the specified env to
    // be directed to the specified version.
    asyncTasks.push(function(cb) {
      var newRule = {versionId: req.params.versionId, rule: '*'};
      req.app.settings.database.updateTrafficRules(appId, req.params.envName, [newRule], cb);
    });

    async.series(asyncTasks, function(err) {
      if (err) return next(err);

      res.status(200).end();
    });
  });

  // Delete a version
  router.delete('/:versionId', hasRole('admin'), function(req, res, next) {
    // Get the version object
    req.app.settings.deployer.versions.delete(req.params.versionId, req.ext, function(err) {
      if (err) return next(err);

      res.status(204).json({message: 'version deleted'});
    });
  });

  return router;
};
