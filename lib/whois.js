var whois = require('whois');
var async = require('async');

var fieldMappings = {
  'Registrar': 'registrar',
  'Registrant Name': 'registrantName',
  'Registrant Organization': 'registrantOrganization',
  'Registrant Country': 'registrantCountry',
  'Registrant Email': 'registrantEmail',
  'Admin Email': 'adminEmail',
  'Tech Email': 'techEmail'
};

module.exports = function(domainName, callback) {
  async.retry({times: 5, interval: 1000}, function(cb, results) {
    whois.lookup(domainName, cb);
  }, function(err, data) {
    if (err) return callback(err);

    var record = {domainName: domainName};
    var lines = data.split('\n');
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf('No match for domain') !== -1) {
        return callback(null, null);
      }
      var colonIndex = lines[i].indexOf(':');
      if (colonIndex !== -1) {
        var fieldName = lines[i].substr(0, colonIndex);
        if (fieldMappings[fieldName]) {
          record[fieldMappings[fieldName]] = lines[i].substr(colonIndex + 1).trim();
        }
      }
    }

    callback(null, record);
  });
};
