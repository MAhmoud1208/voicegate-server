'use strict';
/* Voice Gate - make/manage license keys (writes to the same store as the server:
 * Upstash Redis when its env vars are set, else data/keys.json).
 *
 *   node newkey.js                      -> one lifetime key
 *   node newkey.js --plan 30            -> a 30-day key
 *   node newkey.js --plan 365 --note "Ahmed" --count 3
 *   node newkey.js --list               -> show every key + its state
 *   node newkey.js --revoke VG-XXXX-... -> block a key
 *   node newkey.js --unbind VG-XXXX-... -> free the key for a new device
 */
var crypto = require('crypto');
var store = require('./store.js');

function arg(name, def) { var i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : def; }
function has(name) { return process.argv.indexOf(name) >= 0; }

var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function group() { var s = '', b = crypto.randomBytes(4); for (var i = 0; i < 4; i++) s += ALPHA[b[i] % ALPHA.length]; return s; }
function newKey() { return 'VG-' + group() + '-' + group() + '-' + group(); }
function fmtDate(ms) { return ms ? new Date(ms).toISOString().slice(0, 10) : '-'; }

function die(e) { console.error('Error:', e && e.message || e); process.exit(1); }

(async function () {
  console.log('store:', store.backend);

  if (has('--list')) {
    var keys = await store.allKeys().catch(die);
    var ks = Object.keys(keys);
    if (!ks.length) return console.log('No keys yet.');
    ks.forEach(function (k) {
      var r = keys[k];
      var plan = r.plan === 'lifetime' ? 'lifetime' : (r.plan + ' days');
      var state = r.revoked ? 'REVOKED' : (r.deviceId ? 'active' : 'unused');
      console.log([k, plan.padEnd(10), state.padEnd(8), 'dev:' + (r.deviceName || (r.deviceId ? r.deviceId.slice(0, 8) : '-')), 'since:' + fmtDate(r.activatedAt), r.note ? '(' + r.note + ')' : ''].join('  '));
    });
    return;
  }

  var revoke = arg('--revoke'), unbind = arg('--unbind');
  if (revoke || unbind) {
    var k = (revoke || unbind).trim().toUpperCase();
    var rec = await store.getKey(k).catch(die);
    if (!rec) return console.error('No such key:', k);
    if (revoke) { rec.revoked = true; }
    else { rec.deviceId = null; rec.deviceName = null; rec.activatedAt = null; rec.revoked = false; }
    await store.putKey(k, rec).catch(die);
    console.log(revoke ? ('Revoked ' + k + ' - locks on next online check.') : ('Unbound ' + k + ' - can activate on a new device.'));
    return;
  }

  var planArg = arg('--plan', 'lifetime');
  var plan = (planArg === 'lifetime') ? 'lifetime' : String(parseInt(planArg, 10) || 0);
  if (plan !== 'lifetime' && plan === '0') return console.error('Bad --plan. Use a number of days or "lifetime".');
  var note = arg('--note', '');
  var count = parseInt(arg('--count', '1'), 10) || 1;

  var made = [];
  for (var i = 0; i < count; i++) {
    var key; do { key = newKey(); } while (await store.getKey(key).catch(die));
    await store.putKey(key, { plan: plan, deviceId: null, deviceName: null, activatedAt: null, revoked: false, note: note }).catch(die);
    made.push(key);
  }
  console.log('Made ' + count + ' key(s), plan = ' + (plan === 'lifetime' ? 'lifetime' : plan + ' days') + (note ? ', note "' + note + '"' : '') + ':');
  made.forEach(function (key) { console.log('  ' + key); });
})();
