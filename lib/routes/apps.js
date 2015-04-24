var express = require('express');
var _ = require('lodash');
var shortid = require('shortid');
var async = require('async');
var debug = require('debug')('4front-api:apps');

module.exports = function(options) {
  var router = express.Router();
  var appIdParam = require('../middleware/appid-param')(options);
  var hasRole = require('../middleware/has-role');
  var validateApp = require('../middleware/validate-app')(options);

  // Check if an app with the specified name exists.
  router.head('/:appName', function(req, res, next) {
    req.app.settings.virtualAppRegistry.getByName(req.params.appName, function(err, app) {
      if (err) return next(err);
      res.status(app ? 200 : 404).end();
    });
  });

  // Register middleware for handling the appId parameter
  router.param('appId', appIdParam);

  router.get('/:appId', function(req, res, next) {
    res.json(req.ext.virtualApp);
  });

  router.use('/:appId/versions', require('./versions')(options));

  // Create new app
  router.post('/', [hasRole('admin,contributor'), validateApp], function(req, res, next) {
    var appData = _.extend({}, req.body, {
      appId: shortid.generate(),
      ownerId: req.ext.user.userId,
      trafficControlEnabled: false
    });

    debug("Creating application " + appData.name);

    req.app.settings.database.createApplication(appData, function(err, app) {
      if (err)
        return next(err);

      req.app.settings.virtualAppRegistry.add(app);
      res.status(201).json(app);
    });
  });

  // Update application
  router.put('/:appId', [hasRole('admin'), validateApp], function(req, res, next) {
    var appData = _.extend({}, req.body, {
      appId: req.params.appId
    });

    debug("update application API call");

    // Do not update the trafficControlRules or ownerId
    delete appData.trafficControlRules;
    delete appData.ownerId;

    req.app.settings.database.updateApplication(appData, function(err, updatedApp) {
      if (err) return next(err);

      // Force the app to be reloaded from the database
      req.app.settings.virtualAppRegistry.getById(appData.appId, {forceReload: true}, function(err, virtualApp) {
        if (err) return next(err);
        res.status(200).json(virtualApp);
      });
    });
  });

  // Delete an application
  router.delete('/:appId', hasRole('admin'), function(req, res, next) {
    debug("deleting application " + req.ext.virtualApp.appId);
    async.parallel([
      function(cb) {
        req.app.settings.database.deleteApplication(req.ext.virtualApp.appId, function(err) {
          if (err) return cb(err);

          cb(null);
        });
      },
      function(cb) {
        req.app.settings.deployments.deleteAllVersions(req.ext.virtualApp.appId, cb);
      }
    ], function(err) {
      if (err)
        return next(err);

      req.app.settings.virtualAppRegistry.flushApp(req.ext.virtualApp);

      res.status(204).end();
    });
  });

  // Update the traffic rules for an environment
  router.post('/:appId/traffic-rules/:env', hasRole('admin'), function(req, res, next) {
    req.app.settings.database.updateTrafficRules(req.ext.virtualApp.appId, req.params.env, req.body, function(err) {
      if (err) return next(err);

      if (!req.ext.virtualApp.trafficRules)
        req.ext.virtualApp.trafficRules = {};

      req.ext.virtualApp.trafficRules[req.params.env] = req.body;
      req.app.settings.virtualAppRegistry.flushApp(req.ext.virtualApp);
      res.json(req.body);
    });
  });

  // // Deploy a version to a specific environment
  // router.put('/:appId/deploy', function(req, res, next) {
  //   req.app.settings.database.
  // });

  return router;
};
