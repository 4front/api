var express = require('express');
var _ = require('lodash');
var shortid = require('shortid');
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

  router.get('/:appId', function(req, res, next) {
    // Omit the environment variables.
    res.json(_.omit(req.ext.virtualApp, 'env'));
  });

  router.use('/:appId/versions', require('./versions')(options));
  router.use('/:appId/env', require('./env')(options));

  // Create new app
  router.post('/', [hasRole('admin,contributor'), bodyParser.json(), validateApp], function(req, res, next) {
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
  router.put('/:appId', [hasRole('admin'), bodyParser.json(), validateApp], function(req, res, next) {
    var appData = _.extend({}, req.body, {
      appId: req.params.appId
    });

    debug("update application API call");

    // Do not update the trafficControlRules or ownerId
    delete appData.trafficControlRules;
    delete appData.ownerId;

    req.app.settings.database.updateApplication(appData, function(err, updatedApp) {
      if (err) return next(err);

      req.app.settings.virtualAppRegistry.getById(appData.appId, {forceReload: true}, function(err, virtualApp) {
        if (err) return next(err);
        res.status(200).json(virtualApp);
      });
    });
  });

  // Update the domain registration
  router.post('/:appId/domains', [hasRole('admin'), bodyParser.json()], function(req, res, next) {
    debug("update custom domains to %o", req.body);
    var domainManager = req.app.settings.domains;

    if (!domainManager)
      return next(new Error("No domain registrar configured on the 4front application"));

    var existingDomains = req.ext.virtualApp.domains || [];

    var newDomains = _.difference(req.body, existingDomains);
    var deletedDomains = _.difference(existingDomains, req.body);

    // Call database to update domains.

    async.parallel([
      function(callback) {
        async.each(newDomains, function(domainName, cb) {
          createDomain(req.app.settings, req.ext.virtualApp, domainName, cb);
        }, callback);
      },
      function(callback) {
        async.each(deletedDomains, function(domainName, cb) {
          deleteDomain(req.app.settings, req.ext.virtualApp, domainName, cb);
        }, callback);
      }
    ], function(err) {
      if (err) return next(err);

      req.app.settings.virtualAppRegistry.flushApp(req.ext.virtualApp);
      res.json(req.body);
    });
  });

  // Delete an application
  router.delete('/:appId', hasRole('admin'), function(req, res, next) {
    debug("deleting application " + req.ext.virtualApp.appId);

    req.ext.virtualApp.domains;

    async.parallel([
      function(cb) {
        req.app.settings.database.deleteApplication(req.ext.virtualApp.appId, function(err) {
          if (err) return cb(err);

          cb(null);
        });
      },
      function(cb) {
        req.app.settings.deployer.deleteAllVersions(req.ext.virtualApp.appId, req.ext, cb);
      },
      function(cb) {
        // Unregister domains
        unregisterDomains(req.app.settings, req.ext.virtualApp.domains, cb);
      }
      // TODO: Unregister all the domains
    ], function(err) {
      if (err)
        return next(err);

      req.app.settings.virtualAppRegistry.flushApp(req.ext.virtualApp);
      res.status(204).end();
    });
  });

  // router.post('/:appId/domain', [hasRole('admin'), bodyParser.json()], function(req, res, next) {
  //
  // });

  // Update the traffic rules for an environment
  router.post('/:appId/traffic-rules/:env', [hasRole('admin'), bodyParser.json()], function(req, res, next) {
    req.app.settings.database.updateTrafficRules(req.ext.virtualApp.appId, req.params.env, req.body, function(err) {
      if (err) return next(err);

      if (!req.ext.virtualApp.trafficRules)
        req.ext.virtualApp.trafficRules = {};

      req.ext.virtualApp.trafficRules[req.params.env] = req.body;
      req.app.settings.virtualAppRegistry.flushApp(req.ext.virtualApp);
      res.json(req.body);
    });
  });

  function createDomain(settings, virtualApp, domainName, callback) {
    debug("create domain %s", domainName);
    async.waterfall([
      function(cb) {
        settings.database.createDomain(virtualApp.appId, domainName, cb);
      },
      function(domain, cb) {
        settings.domains.register(domainName, cb);
      },
      function(zoneId, cb) {
        settings.database.updateDomain(virtualApp.appId, domainName, zoneId, cb);
      }
    ], callback);
  }

  function deleteDomain(settings, virtualApp, domainName, callback) {
    debug("delete domain %s", domainName);

    async.waterfall([
      function(cb) {
        settings.database.getDomain(domainName, cb);
      },
      function(domain, cb) {
        // Unregister the domain
        if (settings.domains)
          settings.domains.unregister(domainName, domain.zone, cb);
        else
          cb();
      },
      function(cb) {
        settings.database.deleteDomain(virtualApp.appId, domainName, cb);
      },
    ], callback);
  }

  // Unregister multiple domains
  function unregisterDomains(settings, domainNames, callback) {
    if (!settings.domains)
      return callback();

    async.each(domainNames, function(domainName, cb) {
      // Get the zone of the domain
      settings.database.getDomain(domainName, function(err, domain) {
        if (err) return cb(err);

        settings.domains.unregister(domainName, domain.zone, cb);
      });
    }, callback);
  }

  return router;
};
