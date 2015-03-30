var express = require('express');

module.exports = function(options) {
  var router = express.Router();
  var appIdParam = require('../middleware/appid-param')(options);
  // var hasRole = require('../middleware/hasRole')(options);
  var ensureUserIsOrgContributor = require('../middleware/ensure-org-contributor')(options);
  var validateApp = require('../middleware/validate-app')(options);

  // Check if an app with the specified name exists.
  router.head('/:appName', function(req, res, next) {
    appLookup({name: req.params.appName}, req.app.settings, function(err, app) {
      if (err) return next(err);
      res.status(app ? 200 : 404).end();
    });
  });

  // Register middleware for handling the appId parameter
  router.param('appId', appIdParam);

  router.get('/:appId', function(req, res, next) {
    res.json(req.ext.virtualApp);
  });

  // router.use('/:appId/versions', require('./versions')(dependencies));

  // Create new app
  router.post('/', [ensureUserIsOrgContributor, validateApp], function(req, res, next) {
    _.extend(req.appData, {
      appId: shortid.generate(),
      ownerId: req.user.userId,
      // TODO: Get rid of this.
      trafficControlEnabled: false
    });

    debug("Creating application " + req.appData.name);

    options.database.createApplication(req.appData, function(err, app) {
      if (err)
        return next(err);

      res.status(201).json(app);
    });
  });

  return router;
};
