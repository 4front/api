var assert = require('assert');
var supertest = require('supertest');
var express = require('express');

require('dash-assert');
require('simple-errors');

describe('errors', function() {
  beforeEach(function() {
    this.server = express();

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
        assert.isMatch(res.body, {
          status: 400,
          message: "Request error",
          contextValue: 'foo'
        });
      })
      .end(done);
  });
});
