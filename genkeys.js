'use strict';
/* Voice Gate - generate a fresh Ed25519 signing keypair.
   Writes server/data/private.pem (keep secret) and prints the PUBLIC_KEY
   (base64 DER SPKI) to paste into the plugin's js/config.js. */
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');

var DATA = path.join(__dirname, 'data');
try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) { /* exists */ }
var PRIV = path.join(DATA, 'private.pem');

if (fs.existsSync(PRIV) && process.argv.indexOf('--force') < 0) {
  console.error('private.pem already exists. Pass --force to overwrite (this invalidates every issued key).');
  process.exit(1);
}

var kp = crypto.generateKeyPairSync('ed25519');
var privPem = kp.privateKey.export({ format: 'pem', type: 'pkcs8' });
var pubSpkiDer = kp.publicKey.export({ format: 'der', type: 'spki' });
var pubB64 = Buffer.from(pubSpkiDer).toString('base64');
var privB64 = Buffer.from(kp.privateKey.export({ format: 'der', type: 'pkcs8' })).toString('base64');

fs.writeFileSync(PRIV, privPem);
console.log('Wrote', PRIV, '(keep this secret, never commit it)');
console.log('');
console.log('PUBLIC_KEY  (paste into plugin js/config.js):');
console.log(pubB64);
console.log('');
console.log('PRIVATE_KEY (base64 PKCS8 - use as env var VG_PRIVATE_KEY on a host):');
console.log(privB64);
