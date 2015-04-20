var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
var jwt = require('jwt-simple');
var debug = require('debug')('4front-api:test');
var auth = require('../lib/middleware/auth');
var helper = require('./helper');

require('dash-assert');

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

    this.server.settings.database = {
      getUser: function(userId, callback) {
        callback(null, self.user);
      }
    };

    this.server.settings.jwtTokenSecret = 'asdflkjaskdlfjaskldf';

    // Register middleware for handling the appId parameter
    this.server.use(auth());

    this.server.use(function(req, res, next) {
      res.json(req.ext);
    });

    this.server.use(helper.errorHandler);
  });

  it('sets req.ext.user when X-Access-Token header is valid', function(done) {
    var token = jwt.encode({
      iss: this.userId,
      exp: Date.now() + 100
    }, this.server.get('jwtTokenSecret'));

    supertest(this.server)
      .get('/')
      .set('X-Access-Token', token)
      .expect(200)
      .expect(function(res) {
        assert.equal(res.body.user.userId, self.user.userId);
        assert.ok(res.body.user.isAuthenticated);
      })
      .end(done);
  });

  it('returns 401 when X-Access-Token header is missing', function(done) {
    supertest(this.server)
      .get('/')
      .expect(401)
      .expect(function(res) {
        assert.equal(res.body.code, 'notAuthenticated')
      })
      .end(done);
  });

  it('returns 401 when Authorization header is invalid', function(done) {
    var token = jwt.encode({
      iss: this.userId,
      exp: Date.now() + 100
    }, 'not_the_real_token_secret');

    supertest(this.server)
      .get('/')
      .set('X-Access-Token', token)
      .expect(401)
      .expect(function(res) {
        assert.equal(res.body.code, 'notAuthenticated')
      })
      .end(done);
  });

  it('returns 401 when token is expired', function(done) {
    var token = jwt.encode({
      iss: this.userId,
      exp: Date.now() - 100
    }, this.server.get('jwtTokenSecret'));

    supertest(this.server)
      .get('/')
      .set('X-Access-Token', token)
      .expect(401)
      .expect(function(res) {
        assert.equal(res.body.code, 'notAuthenticated')
      })
      .end(done);
  });

  it('skips authentication of profile/login requests', function(done) {
    supertest(this.server)
      .post('/profile/login')
      .send({username: 'test', password:'password'})
      .expect(200)
      .expect(function(res) {
        assert.isUndefined(res.user);
      })
      .end(done);
  });
});
