var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var moment = require('moment');
var sinon = require('sinon');
var _ = require('lodash');
var debug = require('debug')('4front-api:test');
var profileRoute = require('../lib/routes/profile');
var helper = require('./helper');

require('dash-assert');

describe('routes/profile', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();

    this.server.settings.database = this.database = {};
    this.server.settings.jwtTokenExpireMinutes = 20;
    this.server.settings.jwtTokenSecret = 'asdflaksdjflaksdf';

    this.user = {
      userId: shortid.generate(),
      providerUserId: shortid.generate(),
      provider: 'ActiveDirectory'
    };

    this.server.use(function(req, res, next) {
      debug("setting up request");
      req.ext = {
        user: self.user
      };

      req.session = {
        user: self.user
      };

      next();
    });

    this.server.use(profileRoute());

    this.server.use(helper.errorHandler);
  });

  describe('PUT /', function() {
    it('permission denied when userIds not match', function(done) {
      supertest(this.server)
        .put('/')
        .send({userId: shortid.generate()})
        .expect(401)
        .expect(function(res) {
          assert.equal(res.body.code, 'permissionDenied');
        })
        .end(done);
    });

    it('updates user', function(done) {
      this.database.updateUser = sinon.spy(function(userData, callback) {
        callback(null, userData);
      });

      var userUpdates = {userId: self.user.userId, email: 'test@test.com'};
      supertest(this.server)
        .put('/')
        .send(userUpdates)
        .expect(200)
        .expect(function() {
          assert.isMatch(self.database.updateUser.args[0][0], userUpdates);
        })
        .end(done);
    });
  });

  describe('GET /orgs', function() {
    it('lists user orgs', function(done) {
      this.database.listUserOrgs = sinon.spy(function(userId, callback) {
        callback(null, [
          {orgId: '1'},
          {orgId: '2'}
        ]);
      });

      supertest(this.server)
        .get('/orgs')
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.database.listUserOrgs.calledWith(self.user.userId));
          assert.equal(2, res.body.length);
        })
        .end(done);
    });
  });

  describe('POST /login', function() {
    beforeEach(function() {
      self = this;

      this.username = 'testuser';
      this.password = 'password';
    });

    it('successfully logs in', function(done) {
      this.server.settings.login = sinon.spy(function(username, password, callback) {
        callback(null, {userId: '123'});
      });

      debug('running login test');
      supertest(this.server)
        .post('/login')
        .send({username: this.username, password: this.password})
        .expect(200)
        .expect(function (res) {
          assert.isTrue(self.server.settings.login.calledWith(
            self.username, self.password));
        })
        .end(done);
    });

    it('login failure', function(done) {
      this.server.settings.login = sinon.spy(function(username, password, callback) {
        callback(null, null);
      });

      supertest(this.server)
        .post('/login')
        .send({username: this.username, password: this.password})
        .expect(401)
        .expect(function (res) {
          assert.isTrue(self.server.settings.login.called);
          assert.equal(res.body.code, 'invalidCredentials');
        })
        .end(done);
    });
  });
});
