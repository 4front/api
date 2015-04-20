var express = require('express');
var bodyParser = require('body-parser');
var debug = require('debug')('4front:platform:api-router');
var _ = require('lodash');

require('simple-errors');

module.exports = function(options) {
  // Validate that required options are present
  // var requiredOptions = ['database', 'cache', 'deployments', 'appRegistry'];
  // for (var i=0; i<requiredOptions.length; i++) {
  //   if (!options[requiredOptions[i]])
  //     throw new Error("Missing required option " + requiredOptions[i]);
  // }

  var router = express.Router();

  router.use(bodyParser.json());

  router.use(function(req, res, next) {
    if (!req.ext)
      req.ext = {};

    next();
  });

  // API authentication
  router.use(require('./middleware/auth')());
  router.use('/orgs', require('./routes/orgs')());
  router.use('/apps', require('./routes/apps')());
  router.use('/profile', require('./routes/profile')());

  router.use(require('./middleware/errors'));

  return router;
}
