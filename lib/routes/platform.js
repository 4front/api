var express = require('express'),
  _ = require('lodash'),
  debug = require('debug')('4front-api:system');
  async = require('async'),
  moment = require('moment');

require('simple-errors');

// API routes for orgs
module.exports = function(options) {
  var router = express.Router();

  // Load the set of app starter templates
  router.get('/app-templates', function(req, res, next) {
    
  });
};
