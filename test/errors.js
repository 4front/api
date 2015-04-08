var assert = require('assert');
var sinon = require('sinon');
var supertest = require('supertest');
var express = require('express');

require('dash-assert');
require('simple-errors');

describe('errors', function() {
  var self;

  beforeEach(function() {
    self = this;
    this.server = express();
    this.server.settings.logger = {
      error: sinon.spy(function(){})
    };

    this.server.get('/', function(req, res, next) {
      next(Error.http(400, "Request error", {contextValue: 'foo'}));
    });

    this.server.use(require('../lib/middleware/errors'));
  });

  it('returns error as JSON', function(done) {
    supertest(this.server)
      .get('/')
      .expect(400)
      .expect(function(res) {
        assert.ok(self.server.settings.logger.error.called);

        assert.isMatch(res.body, {
          status: 400,
          message: "Request error",
          contextValue: 'foo'
        });
      })
      .end(done);
  });
});
