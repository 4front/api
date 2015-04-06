var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
var _ = require('lodash');
var bodyParser = require('body-parser');
var debug = require('debug')('4front-api:test');
var orgsRoute = require('../lib/routes/orgs');
var helper = require('./helper');

require('dash-assert');

describe('routes/orgs', function() {
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

    this.orgMembers, this.userInfo = [];

    this.server.use(function(req, res, next) {
      req.ext = {
        user: self.user
      };

      next();
    });

    this.options = {
      database: {
        createOrganization: sinon.spy(function(data, callback) {
          callback(null, data);
        }),
        updateOrganization: sinon.spy(function(data, callback) {
          callback(null, data);
        }),
        terminateOrganization: sinon.spy(function(orgId, callback) {
          callback(null);
        }),
        getOrganization: function(orgId, callback) {
          callback(null, self.organization);
        },
        getUserInfo: sinon.spy(function(userIds, callback) {
          callback(null, self.userInfo);
        }),
        listOrgMembers: sinon.spy(function(orgId, callback) {
          callback(null, self.orgMembers);
        }),
        createOrgMember: sinon.spy(function(member, callback) {
          callback(null, member);
        }),
        updateUser: sinon.spy(function(user, callback) {
          callback(null);
        }),
        createUser: sinon.spy(function(user, callback) {
          callback(null, user);
        }),
        getOrgMember: function(orgId, userId, callback) {
          callback(null, self.orgMember);
        }
      }
    };

    // Register apps route middleware
    this.server.use(bodyParser.json());

    this.server.use(orgsRoute(this.options));

    this.server.use(helper.errorHandler);
  });

  it('get organization', function(done) {
    supertest(this.server)
      .get('/' + this.organization.orgId)
      .expect(200)
      .end(done);
  });

  it('throws 404 if orgId not found', function(done) {
    this.organization = null;
    supertest(this.server)
      .get('/' + shortid.generate())
      .expect(404)
      .end(done);
  });

  it('retrieve org members', function(done) {
    this.orgMembers = [
      {userId: '1', role:'admin'},
      {userId: '2', role: 'contributor'}
    ];

    this.userInfo = {
      '1': {
        username: 'walter'
      },
      '2': {
        username: 'alice'
      }
    };

    supertest(this.server)
      .get('/' + this.organization.orgId + '/members')
      .expect(200)
      .expect(function(res) {
        assert.ok(self.options.database.listOrgMembers.calledWith(self.organization.orgId));
        assert.ok(self.options.database.getUserInfo.calledWith(['1', '2']));
        assert.equal(2, res.body.length);
        assert.deepEqual(_.map(res.body, 'username'), ['alice', 'walter']);
      })
      .end(done);
  });

  describe('create org member', function() {
    it('with existing known user', function(done) {
      var postData = {
        userId: shortid.generate(),
        role: 'admin'
      };

      supertest(this.server)
        .post('/' + this.organization + '/members')
        .send(postData)
        .expect(201)
        .expect(function(res) {
          assert.ok(self.options.database.createOrgMember.called);
          assert.isFalse(self.options.database.updateUser.called);
        })
        .end(done);
    });

    it('existing user by providerId', function(done) {
      var userId = shortid.generate();
      var postData = {
        providerUserId: shortid.generate(),
        provider: 'github',
        role: 'contributor',
        avatar: 'profile.jpg'
      };

      this.options.database.findUser = sinon.spy(function(providerUserId, provider, callback) {
        callback(null, {userId: userId});
      });

      supertest(this.server)
        .post('/' + this.organization + '/members')
        .send(postData)
        .expect(201)
        .expect(function(res) {
          assert.ok(self.options.database.findUser.calledWith(postData.providerUserId, 'github'));
          assert.ok(self.options.database.updateUser.called);
          assert.ok(self.options.database.createOrgMember.called);
          assert.isFalse(self.options.database.createUser.called);
        })
        .end(done);
    });

    it('brand new user', function(done) {
      var userId = shortid.generate();
      var postData = {
        providerUserId: shortid.generate(),
        provider: 'github',
        role: 'contributor',
        avatar: 'profile.jpg'
      };

      this.options.database.findUser = sinon.spy(function(providerUserId, provider, callback) {
        callback(null, null);
      });

      supertest(this.server)
        .post('/' + this.organization + '/members')
        .send(postData)
        .expect(201)
        .expect(function(res) {
          assert.ok(self.options.database.findUser.calledWith(postData.providerUserId, 'github'));
          assert.ok(self.options.database.createUser.called);
          assert.isFalse(self.options.database.updateUser.called);
          assert.ok(self.options.database.createOrgMember.called);
        })
        .end(done);
    });

    it('invalid role', function(done) {
      
    });
  });
});
