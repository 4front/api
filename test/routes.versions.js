var supertest = require('supertest');
var express = require('express');
var shortid = require('shortid');
var assert = require('assert');
var sinon = require('sinon');
var fs = require('fs');
var path = require('path');
var _ = require('lodash');
var debug = require('debug')('4front-api:test');
var versionsRoute = require('../lib/routes/versions');
var helper = require('./helper');

require('dash-assert');

describe('routes/versions', function() {
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
      orgId: shortid.generate(),
      environments: ['production']
    };

    this.virtualApp = {
      appId: shortid.generate(),
      name: 'cool-app',
      url: 'http://cool-app.apphost.com',
      urls: {
        production: 'http://cool-app.apphost.com'
      }
    };

    this.server.use(function(req, res, next) {
      req.ext = {
        user: self.user,
        organization: self.organization,
        orgMember: {
          orgId: self.organization.orgId,
          role: 'admin'
        },
        virtualApp: self.virtualApp
      };

      next();
    });

    this.orgId = shortid.generate();

    this.server.settings.database = this.database = {
      updateVersion: sinon.spy(function(versionData, callback) {
        callback(null, versionData);
      })
    };

    this.server.settings.virtualAppRegistry = this.virtualAppRegistry = {
      getById: function(appId, opts, callback) {
        callback(null, _.find(self.appRegistry, {appId: appId}));
      },
      getByName: function(name, opts, callback) {
        callback(null, _.find(self.appRegistry, {name: name}));
      },
      buildEnvUrl: function(virtualApp) {
        return 'https://' + virtualApp.name + '.apphost.com';
      },
      flushApp: sinon.spy(function() {
      })
    };

    this.server.settings.deployer = this.deployer = {
      versions: {
        create: sinon.spy(function(versionData, context, callback) {
          callback(null, _.extend(versionData, {versionId: shortid.generate(), complete: false}));
        }),
        updateStatus: sinon.spy(function(versionData, context, options, callback) {
          callback(null, {versionId: versionData.versionId, complete: true});
        }),
        delete: sinon.spy(function(versionId, context, callback) {
          callback();
        })
      },
      deploy: sinon.spy(function(appId, versionId, fileInfo, callback) {
        callback();
      })
    };

    // Register middleware for handling the appId parameter
    this.server.use(versionsRoute(this.options));

    this.server.use(helper.errorHandler);
  });

  describe('POST /', function() {
    it('creates new version', function(done) {
      supertest(this.server)
        .post('/')
        .send({name: 'v2'})
        .expect(201)
        .expect(function(res) {
          assert.ok(self.deployer.versions.create.calledWith(sinon.match({
            name: 'v2'
          })));
        })
        .end(done);
    });
  });

  describe('PUT /:versionId/complete', function() {
    it('mark version complete', function(done) {
      this.virtualApp.trafficControlEnabled = true;

      var versionId = shortid.generate();
      supertest(this.server)
        .put('/' + versionId + '/complete')
        .expect(200)
        .expect(function(res) {
          assert.ok(self.deployer.versions.updateStatus.calledWith({
            versionId: versionId, status: 'complete'
          }));
        })
        .end(done);
    });
  });

  describe('GET /:versionId', function() {
    it('returns version', function(done) {
      var versionId = shortid.generate();
      this.database.getVersion = sinon.spy(function(appId, _versionId, callback) {
        callback(null, {versionId: versionId});
      });

      supertest(this.server)
        .get('/' + versionId)
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.database.getVersion.calledWith(self.virtualApp.appId, versionId));
          assert.equal(res.body.versionId, versionId);
        })
        .end(done);
    });

    it('returns 404 for missing version', function(done) {
      this.database.getVersion = sinon.spy(function(appId, versionId, callback) {
        callback(null, null);
      });

      supertest(this.server)
        .get('/' + shortid.generate())
        .expect(404)
        .expect(function(res) {
          assert.equal(res.body.code, 'versionNotFound');
        })
        .end(done);
    });
  });

  describe('GET /', function() {
    it('lists versions', function(done) {
      var dbVersions = _.times(3, function(i) {
        var version = {
          appId: self.virtualApp.appId,
          versionId: shortid.generate(),
          versionNum: i + 1,
          userId: i.toString()
        };

        if (i === 0) {
          version.status = 'initiated';
          version.created = new Date(Date.now() - 10 * 60 * 1000).toUTCString();
        } else {
          version.status = 'completed';
          version.created = new Date().toUTCString();
        }
        return version;
      });

      _.extend(this.database, {
        listVersions: sinon.spy(function(appId, options, callback) {
          callback(null, dbVersions);
        }),
        getUserInfo: sinon.spy(function(userIds, callback) {
          var userInfo = {};
          _.times(3, function(i) {
            userInfo[i.toString()] = {
              username: 'user' + (i + 1)
            };
          });

          callback(null, userInfo);
        })
      });

      this.virtualApp.trafficRules = {
        production: [
          {
            versionId: dbVersions[1].versionId,
            rule: '*'
          }
        ]
      };

      supertest(this.server)
        .get('/')
        .expect(200)
        .expect(function(res) {
          assert.equal(3, res.body.length);
          assert.deepEqual(_.map(res.body, 'username'), ['user3', 'user2', 'user1']);
          assert.isTrue(self.database.listVersions.calledWith(self.virtualApp.appId));
          assert.noDifferences(self.database.getUserInfo.args[0][0], _.map(dbVersions, 'userId'));

          // The first version should be marked as failed.
          assert.isTrue(self.deployer.versions.updateStatus.calledWith(sinon.match({
            versionId: dbVersions[0].versionId,
            status: 'failed',
            error: 'Deployment timed out'
          })));

          var versionWithTrafficRules = _.find(res.body, {versionId: dbVersions[1].versionId});
          assert.deepEqual(versionWithTrafficRules.trafficRules, [
            {
              envName: 'production',
              rule: '*',
              url: 'http://' + self.virtualApp.name + '.apphost.com'
            }
          ]);
        })
        .end(done);
    });
  });

  describe('PUT /:versionId', function() {
    it('updates version name and message', function(done) {
      var versionData = {
        versionId: shortid.generate(),
        name: '1.0.0',
        message: 'version message',
        versionNum: 5 // This should not get updated
      };

      self.database.updateVersion = sinon.spy(function(_versionData, callback) {
        callback(null, versionData);
      });

      supertest(this.server)
        .put('/' + versionData.versionId)
        .send(versionData)
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.database.updateVersion.calledWith(_.omit(versionData, 'versionNum')));
        })
        .end(done);
    });
  });

  describe('DELETE /:versionId', function() {
    it('deletes version', function(done) {
      var versionId = shortid.generate();

      supertest(this.server)
        .delete('/' + versionId)
        .expect(204)
        .expect(function(res) {
          assert.isTrue(self.deployer.versions.delete.calledWith(versionId));
        })
        .end(done);
    });
  });

  describe('POST /:versionId/deploy', function() {
    it('deploys file', function(done) {
      var versionId = shortid.generate();
      var testFile = path.resolve(__dirname, './fixtures/lorum-ipsum.html');
      var fileSize = fs.statSync(testFile).size;

      supertest(this.server)
        .post('/' + versionId + '/deploy/html/lorum-ipsum.html')
        .set('Content-Length', fileSize)
        .send(fs.readFileSync(testFile).toString())
        .expect(201)
        .expect(function(res) {
          assert.isTrue(self.deployer.deploy.calledWith(self.virtualApp.appId, versionId, sinon.match({
            path: 'html/lorum-ipsum.html',
            size: fileSize
          })));

          assert.equal(res.body.filePath, 'html/lorum-ipsum.html');
        })
        .end(done);
    });
  });

  describe('POST /:versionId/push/:envName', function() {
    beforeEach(function() {
      _.extend(this.database, {
        updateTrafficRules: sinon.spy(function(appId, envName, rules, cb) {
          cb();
        }),
        deleteTrafficRules: sinon.spy(function(appId, envName, cb) {
          cb();
        })
      });
    });

    it('push all traffic to version', function(done) {
      var versionId = shortid.generate();
      this.virtualApp.trafficRules = {
        production: [{versionId: shortid.generate(), rule: '*'}],
        test: [{versionId: versionId, rule: '*'}]
      };

      supertest(this.server)
        .post('/' + versionId + '/push/production')
        .send({deleteOtherEnvRules: true})
        .expect(200)
        .expect(function(res) {
          assert.isTrue(self.database.deleteTrafficRules.called);
          assert.isTrue(self.database.deleteTrafficRules.calledWith(
            self.virtualApp.appId, 'test'));

          var lastUpdate = self.database.updateTrafficRules.lastCall;
          assert.equal(lastUpdate.args[1], 'production');
          assert.equal(lastUpdate.args[2].length, 1);
          assert.deepEqual(lastUpdate.args[2][0], {versionId: versionId, rule: '*'});
        })
        .end(done);
    });
  });
});
