var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var debug = require('debug')('4front-api:test');
var hasRole = require('../lib/middleware/has-role');
var helper = require('./helper');

require('dash-assert');

describe('hasRole()', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();

    this.user = {
      userId: shortid.generate(),
      username: 'tester',
      secretKey: shortid.generate()
    };

    this.orgMember = {
      role: 'admin',
      orgId: shortid.generate(),
      userId: this.user.userId
    };

    this.server.use(function(req, res, next) {
      debug('initialize req.ext');
      req.ext = {
        user: self.user,
        orgMember: self.orgMember
      };

      next();
    });

    this.requiredRoles = null;

    this.server.get('/', function(req, res, next) {
      hasRole(self.requiredRoles)(req, res, function(err) {
        if (err) return next(err);
        res.json(req.ext);
      });
    });

    this.server.use(helper.errorHandler);
  });

  it('has valid roles ', function(done) {
    this.orgMember.role = 'admin';
    this.requiredRoles = ['admin', 'contributor'];

    supertest(this.server)
      .get('/')
      .expect(200)
      .end(done);
  });

  it('returns 401 when lacking required role', function(done) {
    this.orgMember.role = 'readonly';
    this.requiredRoles = 'admin,contributor';

    supertest(this.server)
      .get('/')
      .expect(401)
      .expect(function(res) {
        assert.equal(res.body.code, 'lackRequiredRole');
        assert.noDifferences(res.body.requiredRole, ['admin', 'contributor']);
      })
      .end(done);
  });
});
