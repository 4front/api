var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
var bodyParser = require('body-parser');
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

    this.userInfo = [];

    this.server.use(bodyParser.json());
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
      createApplication: sinon.spy(function(data, callback) {
        callback(null, data);
      }),
      getAppName: function(name, callback) {
        callback(null, self.appName);
      },
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
      getOrgMember: function(orgId, userId, callback) {
        callback(null, self.orgMember);
      }
    };

    this.server.settings.membership = this.membership = {
      createUser: sinon.spy(function(userData, callback) {
        callback(null, userData);
      }),
      updateProfile: sinon.spy(function(userData, callback) {
        callback(null, userData);
      })
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
      this.database.listOrgApplications = sinon.spy(function(orgId, callback) {
        callback(null, _.map(appIds, function(appId) {
          return {appId: appId, orgId: self.organization.orgId};
        }));
      });

      this.server.settings.virtualAppRegistry = {
        fixUpApp: sinon.spy(function(app) {
          return app;
        })
      };

      supertest(this.server)
        .get('/' + this.organization.orgId + '/apps')
        .expect(200)
        .expect(function(res) {
          assert.equal(self.server.settings.virtualAppRegistry.fixUpApp.callCount, 3);
          assert.noDifferences(_.map(res.body, 'appId'), appIds);
        })
        .end(done);
    });
  });

  describe('GET /:orgId/apps/count', function() {
    it('retrieves org apps', function(done) {
      var appIds = ['1', '2', '3'];
      this.database.countOrgApplications = sinon.spy(function(orgId, callback) {
        callback(null, appIds.length);
      });

      supertest(this.server)
        .get('/' + this.organization.orgId + '/apps/count')
        .expect(200)
        .expect(function(res) {
          assert.equal(res.body, appIds.length);
        })
        .end(done);
    });
  });

  // Test creating an application
  describe('POST /:orgId/apps', function() {
    it('creates app', function(done) {
      this.server.settings.virtualAppRegistry = {
        add: sinon.spy(function() {})
      };

      var appData = {
        name: 'app-name',
        orgId: this.organization.orgId
      };

      supertest(this.server)
        .post('/' + this.organization.orgId + '/apps')
        .send(appData)
        .expect(201)
        .expect(function(res) {
          assert.isMatch(res.body, appData);
          assert.ok(res.body.appId);
          assert.equal(self.user.userId, res.body.ownerId);
          assert.ok(self.database.createApplication.called);
          assert.ok(self.server.settings.virtualAppRegistry.add.calledWith(
            sinon.match({appId: res.body.appId})));
        })
        .end(done);
    });
  });

  describe('GET /:orgId/members', function() {
    it('retrieve org members', function(done) {
      this.database.listOrgMembers = sinon.spy(function(orgId, callback) {
        callback(null, [
          {userId: '1', role: 'admin'},
          {userId: '2', role: 'contributor'}
        ]);
      });

      this.database.getUserInfo = sinon.spy(function(userIds, callback) {
        callback(null, {
          1: {
            username: 'walter'
          },
          2: {
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
          assert.isFalse(self.membership.updateProfile.called);
        })
        .end(done);
    });

    it('existing user by providerId', function(done) {
      var userId = shortid.generate();
      var postData = {
        username: shortid.generate(),
        provider: 'ldap',
        role: 'contributor',
        avatar: 'profile.jpg'
      };

      this.membership.findUser = sinon.spy(function(query, providerName, callback) {
        callback(null, {userId: userId, provider: providerName});
      });

      supertest(this.server)
        .post('/' + this.organization + '/members')
        .send(postData)
        .expect(201)
        .expect(function(res) {
          assert.ok(self.membership.findUser.calledWith({username: postData.username}, 'ldap'));
          assert.ok(self.membership.updateProfile.called);
          assert.ok(self.database.createOrgMember.called);
          assert.isFalse(self.membership.createUser.called);
        })
        .end(done);
    });

    it('brand new user', function(done) {
      var postData = {
        username: 'sally',
        provider: 'ldap',
        role: 'contributor',
        avatar: 'profile.jpg'
      };

      this.membership.findUser = sinon.spy(function(username, provider, callback) {
        callback(null, null);
      });

      supertest(this.server)
        .post('/' + this.organization + '/members')
        .send(postData)
        .expect(201)
        .expect(function(res) {
          assert.ok(self.membership.findUser.calledWith(
            {username: postData.username}, 'ldap'));

          assert.ok(self.membership.createUser.calledWith(sinon.match(
            _.pick(postData, 'username', 'avatar'))));

          assert.isFalse(self.membership.updateProfile.called);
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

    it('org default values', function(done) {
      supertest(this.server)
        .post('/')
        .send({name: 'org name'})
        .expect(201)
        .expect(function(res) {
          assert.isTrue(self.database.createOrganization.calledWith(sinon.match({
            environments: ['production']
          })));
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

  it('DEL /:orgId', function(done) {
    _.extend(this.database, {
      deleteOrgMembers: sinon.spy(function(orgId, callback) {
        callback(null);
      }),
      deleteOrganization: sinon.spy(function(orgId, callback) {
        callback(null);
      })
    });

    supertest(this.server)
      .del('/' + this.organization.orgId)
      .expect(204)
      .expect(function(res) {
        assert.ok(self.database.deleteOrgMembers.calledWith(self.organization.orgId));
        assert.ok(self.database.deleteOrganization.calledWith(self.organization.orgId));
      })
      .end(done);
  });
});
