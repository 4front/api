var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
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

    this.userId = shortid.generate();
    this.virtualApp = {
      appId: shortid.generate(),
      orgId: shortid.generate()
    };

    this.orgMember = {
      userId: this.userId,
      orgId: this.virtualApp.orgId,
      role: 'admin'
    };

    this.server.use(function(req, res, next) {
      req.ext = {};
      req.user = {userId: shortid.generate()};
      next();
    });

    this.database = {
      getOrgMember: function(orgId, userId, callback) {
        callback(null, self.orgMember);
      }
    };

    // Register middleware for handling the appId parameter
    this.server.param('appId', appIdParam({
      appLookup: function(query, settings, callback) {
        callback(null, self.virtualApp);
      },
      database: self.database
    }));

    this.server.get('/:appId', function(req, res, next) {
      debug("/" + req.params.appId);
      res.json(req.ext);
    });

    this.server.use(helper.errorHandler);
  });

  it('sets req.ext when user is member of parent org', function(done) {
    supertest(this.server)
      .get('/' + this.virtualApp.appId)
      .expect(200)
      .expect(function(res) {
        debugger;
        assert.equal(res.body.virtualApp.appId, self.virtualApp.appId);
        assert.equal(res.body.orgRole, 'admin');
        assert.equal(res.body.orgId, self.virtualApp.orgId);
      })
      .end(done);
  });

  it('returns 404 when appId doesnt exist', function(done) {
    this.virtualApp = null;

    supertest(this.server)
      .get('/' + shortid.generate())
      .expect(404)
      .expect(function(res) {
        assert.equal(res.body.code, "appNotFound");
      })
      .end(done);
  });

  it('returns 401 if user is not a member of parent org', function(done) {
    this.orgMember = null;

    supertest(this.server)
      .get('/' + shortid.generate())
      .expect(401)
      .expect(function(res) {
        debugger;
        assert.equal(res.body.code, "userNotOrgMember");
      })
      .end(done);
  });
});
