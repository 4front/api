var express = require('express');
var bodyParser = require('body-parser');
var debug = require('debug')('4front:platform:api-router');
var _ = require('lodash');
var cors = require('cors');

require('simple-errors');

module.exports = function(settings) {
  var router = express.Router();

  router.use(cors());
  // router.use(bodyParser.json());

  router.use(function(req, res, next) {
    if (!req.ext)
      req.ext = {};

    next();
  });

  // API authentication
  router.use(require('./middleware/auth')());
  router.use('/orgs', decorate(require('./routes/orgs')()));
  router.use('/apps', decorate(require('./routes/apps')()));
  router.use('/versions', decorate(require('./routes/versions')()));
  router.use('/profile', decorate(require('./routes/profile')()));
  router.use('/dev', decorate(require('./routes/dev')()));
  router.use('/platform', decorate(require('./routes/platform')()));

  return decorate(router);

  return router;

  // Decorate the router with error handler and a catch-all route
  function decorate(router) {
    // API error handler middleware
    router.use(function(err, req, res, next) {
      if (!err.status)
        err.status = 500;

      req.app.settings.logger.middleware.error(err, req, res, function() {
        res.status(err.status).json(_.omit(Error.toJson(err), 'stack'));
      });
    });

    router.all('*', function(req, res, next) {
      next(Error.http(404, "Endpoint " + req.originalUrl + " not found", {code: "notFound"}));
    });

    return router;
  }
}
