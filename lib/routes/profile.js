
var express = require('express'),
  debug = require('debug')('4front-api:profile'),
  bodyParser = require('body-parser');

require('simple-errors');

// API routes for orgs
module.exports = function() {
  var router = express.Router();

  // Update the user profile
  router.put('/', bodyParser.json(), function(req, res, next) {
    var profile = req.body;
    if (req.ext.user.userId !== profile.userId) {
      return next(Error.http(401, 'Permission denied', {code: 'permissionDenied'}));
    }

    debug('Updating profile for user ' + profile.userId);
    req.app.settings.membership.updateProfile(profile, function(err) {
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

  // POST username, password, and identity provider name and get back
  // user user object which will have a jwt property.
  router.post('/login', bodyParser.json(), function(req, res, next) {
    debug('invoke the login provider');

    req.app.settings.membership.login(req.body.username, req.body.password, function(err, user) {
      if (err) {
        if (err.code === 'invalidCredentials') {
          return next(Error.http(401, 'Invalid credentials', {code: 'invalidCredentials'}));
        }

        return next(err);
      }

      res.json(user);
    });
  });

  return router;
};
