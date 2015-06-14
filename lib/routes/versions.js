var async = require('async');
var _ = require('lodash');
var shortid = require('shortid');
var express = require('express');
var through = require('through2');
var bodyParser = require('body-parser');
var hasRole = require('../middleware/has-role');
var debug = require('debug')('4front:api:versions');

require('simple-errors');

module.exports = function(options) {
  var router = express.Router();

  // Create a new version
  router.post('/', [hasRole('contributor,admin'), bodyParser.json()], function(req, res, next) {
    req.app.settings.deployer.createVersion(req.body, req.ext, function(err, version) {
      if (err) return next(err);
      return res.status(201).json(version);
    });
  });

  // Mark a version as complete
  router.put('/:versionId/complete', [hasRole('contributor,admin'), bodyParser.json()], function(req, res, next) {

    req.app.settings.deployer.markVersionComplete(req.params.versionId, req.ext, req.body, function(err, version) {
      if (err) return next(err);
      res.status(200).json(version);
    });
  });

  // Get a specific version
  router.get('/:versionId', function(req, res, next) {
    req.app.settings.database.getVersion(req.ext.virtualApp.appId, req.params.versionId, function(err, version) {
      if (err) return next(err);

      if (!version)
        return next(Error.http(404, "Version " + req.params.versionId + " not found", {code: "versionNotFound"}));

      res.json(version);
    });
  });

  // List versions
  router.get('/', function(req, res, next) {
    var options = {limit: req.query.limit || 20, excludeIncomplete: false};

    req.app.settings.database.listVersions(req.ext.virtualApp.appId, options, function(err, versions) {
      if (err) return next(err);

      // Get the list of unique userIds from the versions
      var userIds = _.uniq(_.compact(_.map(versions, 'userId')));

      // Get the username for each version
      req.app.settings.database.getUserInfo(userIds, function(err, userInfoMap) {
        if (err) return next(err);

        _.each(versions, function(version) {
          var userInfo = userInfoMap[version.userId];
          if (userInfo)
            _.extend(version, _.pick(userInfo, 'username', 'avatar'));
        });

        versions = _.sortBy(versions, 'created').reverse();
        res.json(versions);
      });
    });
  });

  // Update the name and message of a version
  router.put('/:versionId', [hasRole('admin,contributor'), bodyParser.json()], function(req, res, next) {
    var versionData = _.pick(req.body, 'name', 'message');
    versionData.versionId = req.params.versionId;

    req.app.settings.database.updateVersion(versionData, function(err, version) {
      if (err) return next(err);

      res.json(version);
    });
  });

  // Deploy a file to a specific version
  router.post('/:versionId/deploy/*', hasRole('admin,contributor'), function(req, res, next) {
    var pathParts = req.originalUrl.split('/');
    var filePath = _.slice(pathParts, pathParts.indexOf('deploy') + 1).join('/');

    debug('deploying file %s', filePath);

    var fileInfo = {
      path: filePath,
      // Pipe through passthrough stream as setting req.storage.blob to req directly
      // doesn't work.
      contents: req.pipe(through(function(chunk, enc, callback) {
        this.push(chunk);
        callback();
      })),
      size: parseInt(req.header('content-length'))
    };

    if (req.header('content-type') === 'application/gzip')
      fileInfo.gzipEncoded = true;

    req.app.settings.deployer.deployFile(fileInfo, req.params.versionId, req.ext, function(err) {
      if (err) return next(err);

      res.status(201).json({filePath: fileInfo.path});
    });
  });

  // Delete a version
  router.delete('/:versionId', hasRole('admin'), function(req, res, next) {
    // Get the version object
    req.app.settings.deployer.deleteVersion(req.params.versionId, req.ext, function(err) {
      if (err) return next(err);

      res.status(204).json({message: "version deleted"});
    });
  });

  return router;
};
