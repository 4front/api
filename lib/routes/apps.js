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

  // Create a new custom domain
  router.put('/:appId/domain', [hasRole('admin'), bodyParser.json()], function(req, res, next) {
    if (!req.app.settings.domains)
      return next(new Error("No domain registrar configured on the 4front application"));

    var domainName = req.body.domainName;
    debug("add custom domain %o to app %s", domainName, req.ext.virtualApp.appId);

    // Validate the CNAME
    if (_.isEmpty(domainName) || /^[a-z-_\.]+$/.test(domainName) === false)
      return next(Error.http(400, "Invalid domain name", {code: 'invalidDomainName'}));

    async.waterfall([
      function(cb) {
        req.app.settings.database.createDomain(req.ext.virtualApp.appId, domainName, cb);
      },
      function(domain, cb) {
        req.app.settings.domains.register(domainName, cb);
      },
      function(zoneId, cb) {
        req.app.settings.database.updateDomain(req.ext.virtualApp.appId, domainName, zoneId, cb);
      }
    ], function(err) {
      if (err) return next(err);

      req.app.settings.virtualAppRegistry.getById(req.ext.virtualApp.appId, {forceReload: true}, function(err, virtualApp) {
        if (err) return next(err);
        res.status(200).json(virtualApp);
      });
    });
  });

  // Delete a custom domain
  router.delete('/:appId/domain', [hasRole('admin'), bodyParser.json()], function(req, res, next) {
    if (!req.app.settings.domains)
      return next(new Error("No domain registrar configured on the 4front application"));

    var domainName = req.body.domainName;

    req.app.settings.database.getDomain(domainName, function(err, domain) {
      if (err) return next(err);

      if (!domain) {
        debug("domain %s not found", domainName);
        return next(Error.http(404, "Domain " + domainName + " not found", {code: 'domainNotFound'}));
      }

      if (domain.appId !== req.ext.virtualApp.appId) {
        return next(Error.http(403, "Cannot delete domain " + domainName + " that does not belong to this app"));
      }

      async.parallel([
        function(cb) {
          if (req.app.settings.domains)
            req.app.settings.domains.unregister(domainName, domain.zone, cb);
          else
            cb();
        },
        function(cb) {
          req.app.settings.database.deleteDomain(req.ext.virtualApp.appId, domainName, cb);
        }
      ], function(err) {
        if (err) return next(err);

        req.app.settings.virtualAppRegistry.getById(req.ext.virtualApp.appId, {forceReload: true}, function(err, virtualApp) {
          if (err) return next(err);
          res.status(200).json(virtualApp);
        });
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
        req.app.settings.deployer.deleteAllVersions(req.ext.virtualApp.appId, req.ext, cb);
      },
      function(cb) {
        // Unregister domains
        unregisterDomains(req.app.settings, req.ext.virtualApp.domains, cb);
      }
    ], function(err) {
      if (err)
        return next(err);

      req.app.settings.virtualAppRegistry.flushApp(req.ext.virtualApp);
      res.status(204).end();
    });
  });

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

  // Unregister multiple domains
  function unregisterDomains(settings, domainNames, callback) {
    if (!settings.domains || _.isArray(domainNames) === false)
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
