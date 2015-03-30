var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
var debug = require('debug')('4front-api:test');
var auth = require('../lib/middleware/auth');
var helper = require('./helper');

describe('auth()', function() {
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
      req.ext = {};
      next();
    });

    this.database = {
      getUser: function(userId, callback) {
        callback(null, self.user);
      }
    };

    // Register middleware for handling the appId parameter
    this.server.use(auth({database: this.database}));

    this.server.get('/', function(req, res, next) {
      res.json(req.ext);
    });

    this.server.use(helper.errorHandler);
  });

  it('sets req.ext.user when Authorization header is valid', function(done) {
    supertest(this.server)
      .get('/')
      .set('Authorization', 'Basic ' + new Buffer(this.user.userId + ':' + this.user.secretKey).toString('base64'))
      .expect(200)
      .expect(function(res) {
        assert.equal(res.body.user.userId, self.user.userId);
        assert.ok(res.body.user.isAuthenticated);
      })
      .end(done);
  });

  it('returns 403 when Authorization header is missing', function(done) {
    supertest(this.server)
      .get('/')
      .expect(403)
      .expect(function(res) {
        assert.equal(res.body.code, 'invalidCredentials')
      })
      .end(done);
  });

  it('returns 403 when Authorization header is invalid', function(done) {
    supertest(this.server)
      .get('/')
      .set('Authorization', new Buffer('asdfasdf').toString('base64'))
      .expect(403)
      .expect(function(res) {
        assert.equal(res.body.code, 'invalidCredentials')
      })
      .end(done);
  });

  it('returns 403 when secretKey doesnt match', function(done) {
    supertest(this.server)
      .get('/')
      .set('Authorization', 'Basic ' + new Buffer(this.user.userId + ':asdfasdf').toString('base64'))
      .expect(401)
      .expect(function(res) {
        assert.equal(res.body.code, 'invalidCredentials')
      })
      .end(done);
  });
});
