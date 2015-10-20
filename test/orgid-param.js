var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var debug = require('debug')('4front-api:test');
var orgIdParam = require('../lib/middleware/orgid-param');
var helper = require('./helper');

describe('orgIdParam', function() {
  var self;

  before(function() {
    self = this;
  });

  beforeEach(function() {
    this.server = express();
    this.server.settings.database = {
      getOrganization: function(orgId, callback) {
        callback(null, self.organization);
      },
      getOrgMember: function(orgId, userId, callback) {
        callback(null, self.orgMember);
      }
    };

    this.user = {
      userId: shortid.generate()
    };

    this.organization = {
      orgId: shortid.generate()
    };

    this.orgMember = {
      userId: this.user.userId,
      orgId: this.organization.orgId,
      role: 'admin'
    };

    this.server.use(function(req, res, next) {
      req.ext = {};
      req.ext.user = self.user;
      next();
    });

    // Register middleware for handling the appId parameter
    this.server.param('orgId', orgIdParam());

    this.server.get('/:orgId', function(req, res, next) {
      debug('/' + req.params.orgId);
      res.json(req.ext);
    });

    this.server.use(helper.errorHandler);
  });

  it('sets req.ext.organization when user is member', function(done) {
    supertest(this.server)
      .get('/' + this.organization.orgId)
      .expect(200)
      .expect(function(res) {
        assert.equal(res.body.organization.orgId, self.organization.orgId);
        assert.equal(res.body.orgMember.role, 'admin');
        assert.equal(res.body.orgMember.userId, self.user.userId);
      })
      .end(done);
  });

  it('returns 404 when orgId doesnt exist', function(done) {
    this.organization = null;

    supertest(this.server)
      .get('/' + shortid.generate())
      .expect(404)
      .expect(function(res) {
        assert.equal(res.body.code, 'orgNotFound');
      })
      .end(done);
  });

  it('returns 401 if user is not a member of org', function(done) {
    this.orgMember = null;

    supertest(this.server)
      .get('/' + shortid.generate())
      .expect(401)
      .expect(function(res) {
        assert.equal(res.body.code, 'userNotOrgMember');
      })
      .end(done);
  });
});
