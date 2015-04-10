var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
var _ = require('lodash');
var bodyParser = require('body-parser');
var debug = require('debug')('4front-api:test');
var versionsRoute = require('../lib/routes/versions');
var helper = require('./helper');

describe('routes/versions', function() {
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
      orgId: shortid.generate(),
      environments: ['production']
    };

    this.virtualApp = {
      appId: shortid.generate()
    };

    // this.orgMember = {
    //   userId: self.user.userId,
    //   orgId: shortid.generate(),
    //   role: 'contributor'
    // };

    this.server.use(function(req, res, next) {
      req.ext = {
        user: self.user,
        organization: self.organization,
        virtualApp: self.virtualApp
      };

      next();
    });

    this.orgId = shortid.generate();

    this.options = {
      database: {
        createVersion: sinon.spy(function(data, callback) {
          callback(null, data);
        }),
        deleteVersion: sinon.spy(function(appId, callback) {
          callback(null);
        }),
        nextVersionNum: sinon.spy(function(appId, callback) {
          callback(null, 2);
        }),
        updateDeployedVersions: sinon.spy(function(appId, env, deployedVersions, callback) {
          callback(null);
        })
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
    this.server.use(versionsRoute(this.options));

    this.server.use(helper.errorHandler);
  });

  it('create new version', function(done) {
    var versionData = {
      appId: this.virtualApp.appId,
      versionId: shortid.generate()
    };

    supertest(this.server)
      .post('/')
      .send(versionData)
      .expect(201)
      .expect(function(res) {
        assert.ok(self.options.database.createVersion.called);
        assert.equal(res.body.versionId, versionData.versionId);
        assert.equal(res.body.versionNum, 2);
        assert.equal(res.body.name, 'v2');
      })
      .end(done);
  });
});
