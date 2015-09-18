var express = require('express');
var _ = require('lodash');
var bodyParser = require('body-parser');

var GLOBAL_ENV = '_global';

module.exports = function() {
  var hasRole = require('../middleware/has-role');

  var router = express.Router();

  // View the environment variables.
  var middleware = [hasRole('admin'), bodyParser.json()];

  router.get('/:env?', middleware.concat(validateEnvName), function(req, res) {
    if (req.params.env)
      res.json(req.ext.virtualApp.env[req.params.env] || {});
    else
      res.json(req.ext.virtualApp.env || {});
  });

  // Create a global environment variable
  router.put('/:key', middleware.concat(setGlobalEnvParam), put);

  // Set the value of an environment variable
  router.put('/:env/:key', middleware.concat(validateEnvName), put);

  // Delete global environment variable
  router.delete('/:key', middleware.concat(setGlobalEnvParam), del);

  // Delete a virtual environment specific environment variable
  router.delete('/:env/:key', middleware.concat(validateEnvName), del);

  return router;

  function setGlobalEnvParam(req, res, next) {
    req.params.env = GLOBAL_ENV;
    next();
  }

  function validateEnvName(req, res, next) {
    if (!req.params.env || req.params.env === GLOBAL_ENV)
      return next();

    // Make sure the environment is valid for this organization
    if (!_.contains(req.ext.organization.environments, req.params.env))
      return next(Error.http(404, "Invalid environment " + req.params.env, {
        code: 'invalidVirtualEnv'
      }));

    next();
  }

  function put(req, res, next) {
    if (_.isEmpty(req.body.value)) {
      return next(Error.http(400, "No environment variable value specified"));
    }

    var envOptions = {
      appId: req.ext.virtualApp.appId,
      key: req.params.key,
      virtualEnv: req.params.env || GLOBAL_ENV,
      encrypted: req.body.encrypted === true,
      value: req.body.value
    };

    req.app.settings.database.setEnvironmentVariable(envOptions, function(err) {
      if (err) return next(err);

      req.app.settings.virtualAppRegistry.flushApp(req.ext.virtualApp);
      res.status(200).json({});
    });
  }

  // Delete an environment variable
  function del(req, res, next) {
    req.app.settings.database.deleteEnvironmentVariable(req.ext.virtualApp.appId,
      req.params.env, req.params.key, function(err) {
      if (err) return next(err);

      req.app.settings.virtualAppRegistry.flushApp(req.ext.virtualApp);
      return res.status(204).end();
    });
  }
};
