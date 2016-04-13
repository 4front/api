var express = require('express');
var _ = require('lodash');
var cors = require('cors');
var bodyParser = require('body-parser');

require('simple-errors');

module.exports = function(settings) {
  var router = express.Router();

  router.use(cors());

  router.use(function(req, res, next) {
    if (!req.ext) req.ext = {};

    next();
  });

  // API authentication
  router.use(require('./middleware/auth')());
  router.use('/orgs', bodyParser.json(), decorate(require('./routes/orgs')()));
  router.use('/apps', decorate(require('./routes/apps')()));
  router.use('/versions', decorate(require('./routes/versions')()));
  router.use('/profile', bodyParser.json(), decorate(require('./routes/profile')()));
  router.use('/dev', decorate(require('./routes/dev')()));
  router.use('/platform', bodyParser.json(), decorate(require('./routes/platform')()));

  return decorate(router);

  // Decorate the router with error handler and a catch-all route
  function decorate(_router) {
    _router.all('*', function(req, res, next) {
      next(Error.http(404, 'Endpoint ' + req.originalUrl + ' not found', {code: 'notFound'}));
    });

    return _router;
  }
};
