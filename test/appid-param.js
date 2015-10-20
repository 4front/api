var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
var _ = require('lodash');
var debug = require('debug')('4front-api:test');
var appIdParam = require('../lib/middleware/appid-param');
var helper = require('./helper');

describe('appIdParam', function() {
  var self;

  before(function() {
    self = this;
  });

  beforeEach(function() {
    this.server = express();

    this.user = {
      userId: shortid.generate()
    };

    this.organization = {
      orgId: shortid.generate()
    };

    this.virtualApp = {
      appId: shortid.generate(),
      orgId: this.organization.orgId
    };

    this.orgMember = {
      userId: this.user.userId,
      orgId: this.organization.orgId,
      role: 'admin'
    };

    _.extend(this.server.settings, {
      virtualAppRegistry: {
        getById: function(appId, opts, callback) {
          callback(null, _.find(self.appRegistry, {appId: appId}));
        }
      },
      database: {
        getOrganization: sinon.spy(function(orgId, callback) {
          callback(null, self.organization);
        }),
        getOrgMember: sinon.spy(function(orgId, userId, callback) {
          callback(null, self.orgMember);
        })
      }
    });

    this.database = this.server.settings.database;

    this.server.use(function(req, res, next) {
      req.ext = {};
      req.ext.user = self.user;
      next();
    });

    this.appRegistry = [this.virtualApp];

    // Register middleware for handling the appId parameter
    this.server.param('appId', appIdParam(this.options));

    this.server.get('/:appId', function(req, res, next) {
      debug('/' + req.params.appId);
      res.json(req.ext);
    });

    this.server.use(helper.errorHandler);
  });

  it('sets req.ext when user is member of parent org', function(done) {
    supertest(this.server)
      .get('/' + this.virtualApp.appId)
      .expect(200)
      .expect(function(res) {
        assert.equal(res.body.virtualApp.appId, self.virtualApp.appId);
        assert.equal(res.body.orgMember.role, 'admin');
        assert.equal(res.body.organization.orgId, self.virtualApp.orgId);

        assert.ok(self.database.getOrganization.called);
        assert.ok(self.database.getOrgMember.called);
      })
      .end(done);
  });

  it('returns 404 when appId doesnt exist', function(done) {
    this.appRegistry.length = 0;

    supertest(this.server)
      .get('/' + shortid.generate())
      .expect(404)
      .expect(function(res) {
        assert.equal(res.body.code, 'appNotFound');
      })
      .end(done);
  });

  it('returns 401 if user is not a member of parent org', function(done) {
    this.orgMember = null;

    supertest(this.server)
      .get('/' + this.virtualApp.appId)
      .expect(401)
      .expect(function(res) {
        assert.equal(res.body.code, 'userNotOrgMember');
      })
      .end(done);
  });
});
