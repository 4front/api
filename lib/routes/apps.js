var express = require('express');
var _ = require('lodash');
var async = require('async');
var bodyParser = require('body-parser');
var debug = require('debug')('4front:api:apps');

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

  router.get('/:appId', function(req, res) {
    // Omit the environment variables.
    res.json(_.omit(req.ext.virtualApp, 'env'));
  });

  router.use('/:appId/versions', require('./versions')(options));
  router.use('/:appId/env', require('./env')(options));

  router.use(bodyParser.json());

  // Update the traffic rules for an environment
  router.post('/:appId/traffic-rules/:env', function(req, res, next) {
    var db = req.app.settings.database;
    db.updateTrafficRules(req.ext.virtualApp.appId, req.params.env, req.body, function(err) {
      if (err) return next(err);

      if (!req.ext.virtualApp.trafficRules) {
        req.ext.virtualApp.trafficRules = {};
      }

      req.ext.virtualApp.trafficRules[req.params.env] = req.body;
      res.json(req.body);
    });
  });

  router.use(hasRole('admin'));

  // Update application
  // var updateAppMiddleware = [hasRole('admin'), bodyParser.json(), validateApp];
  // var adminMiddleware = [hasRole('admin'), bodyParser.json()];

  router.put('/:appId', validateApp, function(req, res, next) {
    var appData = _.extend({}, req.body, {
      appId: req.params.appId
    });

    debug('update application API call');

    // Do not update the trafficControlRules or ownerId
    delete appData.trafficControlRules;
    delete appData.ownerId;

    var db = req.app.settings.database;
    var registry = req.app.settings.virtualAppRegistry;
    db.updateApplication(appData, function(err) {
      if (err) return next(err);

      registry.getById(appData.appId, {forceReload: true}, function(_err, virtualApp) {
        if (_err) return next(_err);
        res.status(200).json(virtualApp);
      });
    });
  });

  // Delete an application
  router.delete('/:appId', function(req, res, next) {
    debug('deleting application ' + req.ext.virtualApp.appId);

    async.parallel([
      function(cb) {
        req.app.settings.database.deleteApplication(req.ext.virtualApp.appId, function(err) {
          if (err) return cb(err);

          cb(null);
        });
      },
      function(cb) {
        req.app.settings.deployer.versions.deleteAll(req.ext.virtualApp.appId, req.ext, cb);
      }
    ], function(err) {
      if (err) return next(err);

      res.status(204).end();
    });
  });

  // Delete the traffic rules for a specific environment.
  router.delete('/:appId/traffic-rules/:env', function(req, res, next) {
    var db = req.app.settings.database;
    db.deleteTrafficRules(req.ext.virtualApp.appId, req.params.env, function(err) {
      if (err) return next(err);

      if (req.ext.virtualApp.trafficRules) {
        delete req.ext.virtualApp.trafficRules[req.params.env];
      }

      res.status(204).end();
    });
  });

  return router;
};
