var express = require('express');
var _ = require('lodash');
var cors = require('cors');
var bodyParser = require('body-parser');

require('simple-errors');

module.exports = function() {
  var router = express.Router();

  router.use(cors());

  router.use(function(req, res, next) {
    if (!req.ext) req.ext = {};

    next();
  });

  // API authentication
  router.use(require('./middleware/auth')());
  router.use('/orgs', bodyParser.json(), decorate(require('./routes/orgs')()));
  router.use('/apps', bodyParser.json(), decorate(require('./routes/apps')()));
  router.use('/versions', decorate(require('./routes/versions')()));
  router.use('/profile', bodyParser.json(), decorate(require('./routes/profile')()));
  router.use('/dev', decorate(require('./routes/dev')()));
  router.use('/platform', bodyParser.json(), decorate(require('./routes/platform')()));

  return decorate(router);

  // Decorate the router with error handler and a catch-all route
  function decorate(_router) {
    // API error handler middleware
    _router.use(function(err, req, res, next) {
      if (!err.status) err.status = 500;

      req.app.settings.logger.middleware.error(err, req, res, function() {
        res.status(err.status).json(_.omit(Error.toJson(err), 'stack'));
      });
    });

    _router.all('*', function(req, res, next) {
      next(Error.http(404, 'Endpoint ' + req.originalUrl + ' not found', {code: 'notFound'}));
    });

    return _router;
  }
};
