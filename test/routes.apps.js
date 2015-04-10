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

    this.organization = {
      orgId: shortid.generate()
    };

    this.orgMember = {
      userId: self.user.userId,
      orgId: this.organization.orgId,
      role: 'admin'
    };

    this.server.use(function(req, res, next) {
      req.ext = {
        user: self.user
      };

      next();
    });

    this.appRegistry = [];

    this.options = {
      database: {
        createApplication: sinon.spy(function(data, callback) {
          callback(null, data);
        }),
        updateApplication: sinon.spy(function(data, callback) {
          callback(null, data);
        }),
        deleteApplication: sinon.spy(function(appId, callback) {
          callback(null);
        }),
        updateTrafficRules: sinon.spy(function(appId, environment, rules, callback) {
          callback(null);
        }),
        getAppName: function(name, callback) {
          callback(null, self.appName);
        },
        getOrganization: function(orgId, callback) {
          callback(null, self.organization);
        },
        getOrgMember: function(orgId, userId, callback) {
          callback(null, self.orgMember);
        }
      },
      appRegistry: {
        getById: function(appId, opts, callback) {
          callback(null, _.find(self.appRegistry, {appId: appId}));
        },
        getByName: function(name, opts, callback) {
          callback(null, _.find(self.appRegistry, {name: name}));
        },
        flushApp: sinon.spy(function(app) {
        })
      },
      deployments: {
        deleteAllVersions: sinon.spy(function(appId, callback) {
          callback();
        })
      }
    };

    // Register apps route middleware
    this.server.use(bodyParser.json());

    // Register middleware for handling the appId parameter
    this.server.use(appsRoute(this.options));

    this.server.use(helper.errorHandler);
  });

  describe('check app name existence', function() {
    it('existing app name', function(done) {
      var appData = {appId: shortid.generate(), name: 'appname'};
      this.appRegistry.push(appData);

      supertest(this.server)
        .head('/' + appData.name)
        .expect(200)
        .end(done);
    });

    it('non existing app name', function(done) {
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

    this.appRegistry.push(appData);

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

  it('deletes application', function(done) {
    var appData = {appId: shortid.generate(), orgId: shortid.generate()};
    this.appRegistry.push(appData);

    supertest(this.server)
      .delete('/' + appData.appId)
      .expect(204)
      .expect(function(res) {
        assert.ok(self.options.database.deleteApplication.calledWith(appData.appId));
        assert.ok(self.options.deployments.deleteAllVersions.called);
        assert.ok(self.options.appRegistry.flushApp.called);
      })
      .end(done);
  });

  it('updates traffic rules', function(done) {
    var appData = {appId: shortid.generate(), orgId: shortid.generate()};
    this.appRegistry.push(appData);

    var environment = 'production';
    var rules = [{version:'v1', rule:'*'}];

    supertest(this.server)
      .post('/' + appData.appId + '/traffic-rules/' + environment)
      .send(rules)
      .expect(200)
      .expect(function(res) {
        assert.deepEqual(res.body, rules);
        assert.ok(self.options.database.updateTrafficRules.calledWith(appData.appId, environment));
      })
      .end(done);
  });
});
