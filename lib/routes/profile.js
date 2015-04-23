
var express = require('express'),
  _ = require('lodash'),
  debug = require('debug')('4front-api:profile');
  async = require('async'),
  shortid = require('shortid'),
  moment = require('moment'),
  jwt = require('jwt-simple'),
  randomstring = require('randomstring');

require('simple-errors');

// API routes for orgs
module.exports = function(options) {
  var router = express.Router();

  // Update the user profile
  router.put('/', function(req, res, next) {
    var profile = req.body;
    if (req.ext.user.userId != profile.userId)
      return next(Error.http(401, "Permission denied", {code: "permissionDenied"}));

    debug("Updating profile for user " + profile.userId);
    req.app.settings.database.updateUser(profile, function(err) {
      if (err) return next(err);
      res.json({});
    });
  });

  // Retrieve the list of user orgs
  router.get('/orgs', function(req, res, next) {
    req.app.settings.database.listUserOrgs(req.ext.user.userId, function(err, orgs) {
      if (err) return next(err);

      res.json(orgs);
    });
  });

  // POST username/password and get back user user object which will have a jwt property.
  router.post('/login', function(req, res, next) {
    debug("invoke the login provider");
    req.app.settings.login(req.body.username, req.body.password, function(err, user) {
      if (err)
        return next(Error.http(401, "Identity provider could not log user in", {}, err));

      if (!user)
        return next(Error.http(401, "Invalid credentials", {code: 'invalidCredentials'}));

      res.json(user);
    });
  });

  // TODO: Deprecate this
  router.get('/apps', function(req, res, next) {
    debug("list personal applications");
    req.app.settings.database.userApplications(req.ext.user.userId, function(err, appIds) {
      if (err) return next(err);

      req.app.settings.virtualAppRegistry.batchGetById(appIds, function(err, apps) {
        if (err) return next(err);

        // TODO: This logic should move to the dynamo query once we can modify indexes.
        apps = _.filter(apps, function(app) {
          return !app.orgId;
        });

        res.json(apps);
      });
    });
  });

  return router;
};
