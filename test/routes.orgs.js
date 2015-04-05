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
});
