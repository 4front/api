var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var moment = require('moment');
var sinon = require('sinon');
var _ = require('lodash');
var bodyParser = require('body-parser');
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

    // Register apps route middleware
    this.server.use(bodyParser.json());

    this.server.use(profileRoute());

    this.server.use(helper.errorHandler);
  });

  describe('GET /', function() {
    // this.user
    it('new user', function(done) {
      self.user.userId = null;

      this.database.findUser = sinon.spy(function(providerUserId, provider, callback) {
        callback(null, null);
      });

      this.database.createUser = sinon.spy(function(userData, callback) {
        callback(null, userData);
      });

      supertest(this.server)
        .get('/')
        .expect(201)
        .expect(function() {
          assert.isTrue(self.database.findUser.calledWith(self.user.providerUserId, self.user.provider));
          assert.isTrue(self.database.createUser.called);
          assert.isMatch(self.database.createUser.args[0][0], self.user);
        })
        .end(done);
    });

    it('existing user', function(done) {
      self.user.userId = null;

      var existingUser = {
        userId: shortid.generate(),
        secretKey: shortid.generate(),
        email: 'test@test.com'
      };

      _.extend(this.database, {
        findUser: sinon.spy(function(providerUserId, provider, callback) {
          callback(null, existingUser);
        }),
        listUserOrgs: sinon.spy(function(userId, callback) {
          callback(null, []);
        })
      });

      supertest(this.server)
        .get('/')
        .expect(200)
        .expect(function() {
          assert.isTrue(self.database.findUser.called);
          assert.isTrue(self.database.listUserOrgs.calledWith(existingUser.userId));
        })
        .end(done);
    });

    it('existing user requiring update', function(done) {
      var existingUser = {
        userId: shortid.generate(),
        email: 'test@test.com'
        // omit the secretKey
      };

      _.extend(this.database, {
        findUser: sinon.spy(function(providerUserId, provider, callback) {
          callback(null, existingUser);
        }),
        updateUser: sinon.spy(function(userData, callback) {
          callback(null, userData);
        }),
        listUserOrgs: sinon.spy(function(userId, callback) {
          callback(null, []);
        })
      });

      supertest(this.server)
        .get('/')
        .expect(200)
        .expect(function() {
          assert.isTrue(self.database.findUser.called);
          assert.isTrue(self.database.updateUser.called);
          assert.noDifferences(_.keys(self.database.updateUser.args[0][0]), ['userId', 'avatar', 'secretKey']);
          assert.isTrue(self.database.listUserOrgs.calledWith(existingUser.userId));
        })
        .end(done);
    });
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

  describe('GET /apps', function() {
    it('lists user personal apps', function(done) {
      var appIds = ['1', '2'];
      this.database.userApplications = sinon.spy(function(userId, callback) {
        callback(null, appIds);
      });

      this.server.settings.virtualAppRegistry = {
        batchGetById: sinon.spy(function(appId, callback) {
          callback(null, {appId: appId});
        })
      };

      supertest(this.server)
        .get('/apps')
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.database.userApplications.calledWith(self.user.userId));
          assert.noDifferences(self.server.settings.virtualAppRegistry.batchGetById.args[0][0], appIds);
        })
        .end(done);
    });
  });

  describe('POST /login', function() {
    beforeEach(function() {
      self = this;

      this.user = null;

      this.providerUser = {
        userId: shortid.generate(),
        username: 'testuser',
        displayName: 'Test User'
      };

      this.server.settings.identityProvider = {
        name: 'ActiveDirectory',
        login: sinon.spy(function(username, password, callback) {
          callback(null, self.providerUser);
        })
      };

      this.userId = shortid.generate();
      this.database.findUser = sinon.spy(function(providerUserId, provider, callback) {
        callback(null, {
          userId: self.userId,
          providerUserId: providerUserId,
          provider: provider
        });
      });
    });

    it('successfully logs in', function(done) {
      debug('running login test');
      supertest(this.server)
        .post('/login')
        .send({username: this.providerUser.username, password: 'password'})
        .expect(200)
        .expect(function (res) {
          assert.isTrue(self.server.settings.identityProvider.login.calledWith(
            self.providerUser.username, 'password'));

          assert.isTrue(self.server.settings.database.findUser.calledWith(
            self.providerUser.userId,
            self.server.settings.identityProvider.name));

          assert.isString(res.body.token);
          assert.isNumber(res.body.expires);
          assert.ok(res.body.expires > Date.now());
        })
        .end(done);
    });

    it('login failure', function(done) {
      this.server.settings.identityProvider.login = sinon.spy(function(username, password, callback) {
        callback(new Error("Invalid username/password"));
      });

      supertest(this.server)
        .post('/login')
        .send({username: this.providerUser.username, password: 'password'})
        .expect(401)
        .expect(function (res) {
          assert.isTrue(self.server.settings.identityProvider.login.called);
          assert.isFalse(self.server.settings.database.findUser.called);
        })
        .end(done);
    });
  });
});
