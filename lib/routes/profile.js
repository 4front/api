
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

  router.get('/', function(req, res, next) {
    debug("find user with providerId " + req.ext.user.providerUserId);
    req.app.settings.database.findUser(req.ext.user.providerUserId, req.ext.user.provider, function(err, user) {
      if (err) return next(err);

      if (!user) {
        debug("user %s does not exist, creating.", req.ext.user.providerUserId);
        _.extend(req.ext.user, {
          userId: shortid.generate(),
          lastLogin: new Date(),
          secretKey: randomstring.generate()
        });

        req.app.settings.database.createUser(req.ext.user, function(err, user) {
          if (err) return next(err);

          // Now the user has been created, but we don't have an email address yet.
          _.extend(req.ext.user, user);

          if (_.isObject(req.session) && req.session.user)
            _.extend(req.session.user, user);

          return res.status(201).json(req.ext.user);
        });
      }
      else {
        // The user exists in the database
        debug("user %s %s was found", req.ext.user.providerUserId, req.ext.user.provider);

        // Tack on additional attributes to the user.
        _.extend(req.user, _.pick(user, 'userId', 'secretKey', 'email'));

        var tasks = {};

        // Update the user's avatar and/or their secret key. A user could have an
        // existing record in the user table but no secretKey yet.
        if (_.isEmpty(user.secretKey) === true || req.ext.user.avatar) {
          if (_.isEmpty(user.secretKey) === true)
            req.ext.user.secretKey = randomstring.generate();

          tasks.updateUser = function(cb) {
            req.app.settings.database.updateUser(_.pick(req.ext.user, 'userId', 'avatar', 'secretKey'), cb);
          };
        }

        // List the user's organizations
        tasks.orgs = function(cb) {
          req.app.settings.database.listUserOrgs(user.userId, cb);
        };

        async.parallel(tasks, function(err, results) {
          if (err) return next(err);
          if (results.email)
            req.user.email = results.email.email;

          res.json(_.extend({}, req.user, {orgs: results.orgs}));
        });
      }
    });
  });

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

  // POST username/password and get back a JWT token
  router.post('/login', function(req, res, next) {
    var identityProvider = req.app.settings.identityProvider;

    debug("login with identity provider");
    identityProvider.login(req.body.username, req.body.password, function(err, providerUser) {
      if (err) {
        return next(Error.http(401, "Identity provider could not log user in", {}, err));
      }

      req.app.settings.database.findUser(providerUser.userId, identityProvider.name, function(err, user) {
        if (err) return next(err);

        // Extend the user with additional attributes from the provider. But
        // exclude the userId as that already exists as providerUserId
        _.defaults(user, _.omit(providerUser, 'userId'));

        // Generate a login token that expires in the configured number of minutes
        var expires = Date.now() + (1000 * 60 * req.app.settings.jwtTokenExpireMinutes);
        var token = jwt.encode({
          iss: user.id,
          exp: expires
        }, req.app.get('jwtTokenSecret'));

        res.json({
          token : token,
          expires: expires,
          user: user
        });
      });
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
