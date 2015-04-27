var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var moment = require('moment');
var sinon = require('sinon');
var _ = require('lodash');
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

    this.server.settings.database = this.database = {
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
      updateOrganization: sinon.spy(function(orgData, callback) {
        callback(null, orgData);
      }),
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
    };

    this.server.settings.orgPlans = {
      unlimited: {
        operationLimit:0
      },
      trial: {
        price: 0,
        duration: 45,
        operationLimit:0
      }
    };

    this.server.use(orgsRoute(this.options));

    this.server.use(helper.errorHandler);
  });

  describe('GET /:orgId', function() {
    it('returns organization', function(done) {
      supertest(this.server)
        .get('/' + this.organization.orgId)
        .expect(200)
        .end(done);
    });

    it('throws 404 if orgId not found', function(done) {
      this.database.getOrganization = function(orgId, callback) {
        callback(null, null);
      };

      supertest(this.server)
        .get('/' + shortid.generate())
        .expect(404)
        .end(done);
    });
  });

  describe('GET /:orgId/apps', function() {
    it('retrieves org apps', function(done) {
      var appIds = ['1', '2', '3'];
      this.database.listOrgAppIds = sinon.spy(function(orgId, callback) {
        callback(null, appIds);
      });

      this.server.settings.virtualAppRegistry = {
        batchGetById: sinon.spy(function(appIds, callback) {
          callback(null, _.map(appIds, function(appId) {
            return {appId: appId};
          }));
        })
      };

      supertest(this.server)
        .get('/' + this.organization.orgId + '/apps')
        .expect(200)
        .expect(function(res) {
          assert.noDifferences(_.map(res.body, 'appId'), appIds);
        })
        .end(done);
    });
  });

  describe('GET /:orgId/members', function() {
    it('retrieve org members', function(done) {
      this.database.listOrgMembers = sinon.spy(function(orgId, callback) {
        callback(null, [
          {userId: '1', role:'admin'},
          {userId: '2', role: 'contributor'}
        ]);
      });

      this.database.getUserInfo = sinon.spy(function(userIds, callback) {
        callback(null, {
          '1': {
            username: 'walter'
          },
          '2': {
            username: 'alice'
          }
        });
      });

      supertest(this.server)
        .get('/' + this.organization.orgId + '/members')
        .expect(200)
        .expect(function(res) {
          assert.ok(self.database.listOrgMembers.calledWith(self.organization.orgId));
          assert.ok(self.database.getUserInfo.calledWith(['1', '2']));
          assert.equal(2, res.body.length);
          assert.deepEqual(_.map(res.body, 'username'), ['alice', 'walter']);
        })
        .end(done);
    });
  });

  describe('POST /:orgId/members', function() {
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
          assert.ok(self.database.createOrgMember.called);
          assert.isFalse(self.database.updateUser.called);
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

      this.database.findUser = sinon.spy(function(providerUserId, provider, callback) {
        callback(null, {userId: userId});
      });

      supertest(this.server)
        .post('/' + this.organization + '/members')
        .send(postData)
        .expect(201)
        .expect(function(res) {
          assert.ok(self.database.findUser.calledWith(postData.providerUserId, 'github'));
          assert.ok(self.database.updateUser.called);
          assert.ok(self.database.createOrgMember.called);
          assert.isFalse(self.database.createUser.called);
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

      this.database.findUser = sinon.spy(function(providerUserId, provider, callback) {
        callback(null, null);
      });

      supertest(this.server)
        .post('/' + this.organization + '/members')
        .send(postData)
        .expect(201)
        .expect(function(res) {
          assert.ok(self.database.findUser.calledWith(postData.providerUserId, 'github'));
          assert.ok(self.database.createUser.called);
          assert.isFalse(self.database.updateUser.called);
          assert.ok(self.database.createOrgMember.called);
        })
        .end(done);
    });

    it('invalid role', function(done) {
      supertest(this.server)
        .post('/' + self.organization.orgId + '/members')
        .send({userId: shortid.generate(), role: 'welder'})
        .expect(400)
        .end(done);
    });
  });

  describe('POST /', function() {
    it('valid org', function(done) {
      supertest(this.server)
        .post('/')
        .send({name: 'test org'})
        .expect(201)
        .expect(function(res) {
          assert.ok(self.database.createOrganization.called);
          assert.deepEqual(self.database.createOrgMember.getCall(0).args[0], {
            orgId: res.body.orgId,
            userId: self.user.userId,
            role: 'admin'
          });
        })
        .end(done);
    });

    it('trial plan', function(done) {
      supertest(this.server)
        .post('/')
        .send({name: 'test org', plan: 'trial'})
        .expect(201)
        .expect(function(res) {
          assert.ok(self.database.createOrganization.called);
          assert.isMatch(self.database.createOrganization.args[0][0], {
            trialStart: moment().format('YYYY-MM-DD'),
            trialEnd: moment().add(45, 'days').format('YYYY-MM-DD'),
            monthlyRate: 0,
            activated: false
          });
          assert.isMatch(self.database.updateUser.args[0][0], {usedTrialOrg: true});
        })
        .end(done);
    });

    it('trial org already used', function(done) {
      this.user.usedTrialOrg = true;
      supertest(this.server)
        .post('/')
        .send({name: 'test org', plan: 'trial'})
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'userAlreadyUsedTrial');
        })
        .end(done);
    });

    it('invalid org name', function(done) {
      supertest(this.server)
        .post('/')
        .send({name: ''})
        .expect(400)
        .expect(function(res) {
          assert.equal(res.body.code, 'invalidOrgName');
        })
        .end(done);
    });
  });

  it('PUT /:orgId/terminate', function(done) {
    this.database.deleteOrgMembers = sinon.spy(function(orgId, callback) {
      callback(null);
    });

    supertest(this.server)
      .put('/' + this.organization.orgId + '/terminate')
      .expect(200)
      .expect(function(res) {
        assert.isMatch(self.database.updateOrganization.args[0][0], {
          activated: false,
          terminated: true,
          terminatedBy: self.user.userId
        });
        assert.ok(self.database.deleteOrgMembers.called);
      })
      .end(done);
  });
});
