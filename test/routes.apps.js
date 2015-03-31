var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
var _ = require('lodash');
var bodyParser = require('body-parser');
var debug = require('debug')('4front-api:test');
var appsRoute = require('../lib/routes/apps');
var helper = require('./helper');

describe('routes/apps', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();

    this.user = {
      userId: shortid.generate(),
      username: 'tester',
      secretKey: shortid.generate()
    };

    // this.orgMember = {
    //   userId: self.user.userId,
    //   orgId: shortid.generate(),
    //   role: 'contributor'
    // };

    this.server.use(function(req, res, next) {
      req.ext = {
        user: self.user
      };

      next();
    });

    this.options = {
      database: {
        createApplication: sinon.spy(function(data, callback) {
          callback(null, data);
        }),
        updateApplication: sinon.spy(function(data, callback) {
          callback(null, data);
        }),
        getAppName: function(name, callback) {
          callback(null, self.appName);
        },
        getOrgMember: function(orgId, userId, callback) {
          callback(null, {
            userId: userId,
            orgId: orgId,
            role: 'admin'
          });
        }
      },
      appLookup: function(query, settings, callback) {
        callback(null, null);
      }
    };

    this.server.use(bodyParser.json());
    // Register middleware for handling the appId parameter
    this.server.use(appsRoute(this.options));

    this.server.use(helper.errorHandler);
  });

  describe('check app name existence', function() {
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

  describe('create application', function() {
    var appData = {
      name: 'app-name'
    };

    it('creates app', function(done) {
      supertest(this.server)
        .post('/')
        .send(appData)
        .expect(201)
        .expect(function(res) {
          assert.ok(_.isEqual(_.pick(res.body, _.keys(appData)), appData));
          assert.ok(res.body.appId);
          assert.equal(self.user.userId, res.body.ownerId);
          assert.ok(self.options.database.createApplication.called);
        })
        .end(done);
    });
  });

  it('updates application', function(done) {
    var appData = {
      appId: shortid.generate(),
      name: 'updated-name',
      orgId: shortid.generate()
    };

    this.options.appLookup = function(appId, options, callback) {
      callback(null, appData);
    };

    supertest(this.server)
      .put('/' + appData.appId)
      .send(appData)
      .expect(200)
      .expect(function(res) {
        assert.equal(res.body.name, 'updated-name');
        assert.ok(self.options.database.updateApplication.called);
      })
      .end(done);
  });
});
