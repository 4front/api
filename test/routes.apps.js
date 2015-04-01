var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
var debug = require('debug')('4front-api:test');
var appsRoute = require('../lib/routes/apps');
var helper = require('./helper');

describe('routes/apps', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();

    this.userId = shortid.generate();

    this.user = {
      userId: shortid.generate(),
      username: 'tester',
      secretKey: shortid.generate()
    };

    this.server.use(function(req, res, next) {
      req.ext = {
        user: self.user
      };

      next();
    });

    this.options = {
      database: {
        getUser: function(userId, callback) {
          callback(null, self.user);
        },
        getAppName: function(name, callback) {
          callback(null, self.appName);
        }
      },
      appLookup: function(query, settings, callback) {
        callback(null, null);
      }
    };

    // Register apps route middleware
    this.server.use(appsRoute(this.options));

    this.server.use(helper.errorHandler);
  });

  describe('HEAD /:appName', function() {
    it('existing app name', function(done) {
      var appName = "appname";
      this.options.appLookup = function(query, settings, callback) {
        callback(null, {
          appId: shortid.generate(),
          name: appName
        });
      };

      supertest(this.server)
        .head('/' + appName)
        .expect(200)
        .end(done);
    });

    it('non existing app name', function(done) {
      this.options.appLookup = function(query, settings, callback) {
        callback(null, null);
      };

      supertest(this.server)
        .head('/someappname')
        .expect(404)
        .end(done);
    });
  });


});
