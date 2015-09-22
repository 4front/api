var express = require('express');
require('simple-errors');

// API routes for orgs
module.exports = function() {
  var router = express.Router();

  // Load the set of app starter templates
  router.get('/starter-templates', function(req, res, next) {
    res.json(req.app.settings.starterTemplates);
  });

  return router;
};
