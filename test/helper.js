/* eslint no-console: 0 */
var express = require('express');

require('simple-errors');

module.exports.beforeEach = function() {
  this.server = express();
  var options = {
    database: {},
    cache: {},
    deployments: {},
    appLookup: {}
  };

  this.server.use(require('../lib/api')(options));

  this.server.use(function(err, req, res, next) {
    res.statusCode = err.status || 500;
    if (res.statusCode === 500) {
      console.log(err.stack);
      res.end(err.stack);
    } else {
      res.json(Error.toJson(err));
    }
  });
};

module.exports.errorHandler = function(err, req, res, next) {
  res.statusCode = err.status || 500;
  if (res.statusCode === 500) {
    console.error(Error.toJson(err));
    res.end(err.stack);
  } else {
    res.json(Error.toJson(err));
  }
};
