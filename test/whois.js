var assert = require('assert');
var whois = require('../lib/whois');

require('dash-assert');

describe('whois', function() {
  it('returns null for missing whois record with valid TLD', function(done) {
    whois('missing-24kwj45345asdf.net', function(err, record) {
      if (err) return done(err);

      assert.isNull(record);
      done();
    });
  });

  it('returns null for missing whois record with invalid TLD', function(done) {
    whois('notfound-24kwj45345asdf.xyz', function(err, record) {
      if (err) return done(err);

      assert.isNull(record);
      done();
    });
  });

  it('returns record', function(done) {
    whois('github.com', function(err, record) {
      if (err) return done(err);

      assert.equal(record.domainName, 'github.com');
      assert.equal(record.registrantEmail, 'hostmaster@github.com');
      assert.equal(record.adminEmail, 'hostmaster@github.com');
      assert.equal(record.techEmail, 'hostmaster@github.com');
      assert.equal(record.registrantCountry, 'US');

      done();
    });
  });
});
