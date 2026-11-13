'use strict';
/* Voice Gate - license + update server (no external dependencies).
 *
 * Runs in the cloud, NOT on your PC. Once deployed, your machine can be off and
 * clients still activate. State lives in the store (Upstash Redis in production).
 *
 * Plugin endpoints:
 *   POST /api/validate  { key, deviceId, deviceName, version } -> { ok, token } | { ok:false, error }
 *   POST /api/update    { key, deviceId, version }             -> { ok:true, update:false }
 *   GET  /                                                     -> health
 *
 * Admin endpoints (header  x-admin-token: <VG_ADMIN_TOKEN> ) so you can make keys
 * from any browser/phone without your own machine:
 *   POST /api/admin/newkey  { plan:"lifetime"|<days>, note?, count? } -> { ok, keys:[...] }
 *   GET  /api/admin/list                                             -> { ok, keys:{...} }
 *   POST /api/admin/revoke  { key }                                  -> { ok }
 *   POST /api/admin/unbind  { key }                                  -> { ok }
 *
 * Secret = the Ed25519 private key: env VG_PRIVATE_KEY (base64 PKCS8) in the
 * cloud, or data/private.pem locally. Never commit it.
 */
var http = require('http');
var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var store = require('./store.js');

var DAY = 864e5;
var PORT = process.env.PORT || 8787;
var CHECK_DAYS = parseInt(process.env.VG_CHECK_DAYS || '14', 10);
var ADMIN_TOKEN = process.env.VG_ADMIN_TOKEN || (function () {
  try { return fs.readFileSync(path.join(__dirname, 'data', 'admin.token'), 'utf8').trim(); } catch (e) { return ''; }
})();

/* ---------- private key ---------- */
function loadPrivateKey() {
  if (process.env.VG_PRIVATE_KEY) {
    return crypto.createPrivateKey({ key: Buffer.from(process.env.VG_PRIVATE_KEY, 'base64'), format: 'der', type: 'pkcs8' });
  }
  var pem = path.join(__dirname, 'data', 'private.pem');
  if (fs.existsSync(pem)) return crypto.createPrivateKey(fs.readFileSync(pem));
  console.error('No signing key. Run `node genkeys.js` or set VG_PRIVATE_KEY.');
  process.exit(1);
}
var _pk = null;
function privateKey() { if (!_pk) _pk = loadPrivateKey(); return _pk; }

function sign(payloadObj) {
  var payload = JSON.stringify(payloadObj);
  return { payload: payload, sig: crypto.sign(null, Buffer.from(payload), privateKey()).toString('base64') };
}

/* ---------- key generation (for admin endpoint) ---------- */
var ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function group() { var s = '', b = crypto.randomBytes(4); for (var i = 0; i < 4; i++) s += ALPHA[b[i] % ALPHA.length]; return s; }
function newKey() { return 'VG-' + group() + '-' + group() + '-' + group(); }

/* ---------- light rate limit ---------- */
var hits = {};
function rateOk(id) {
  var now = Date.now(), w = hits[id] || { t: now, n: 0 };
  if (now - w.t > 60000) w = { t: now, n: 0 };
  w.n++; hits[id] = w;
  return w.n <= 20;
}

/* ---------- validate ---------- */
function handleValidate(body, cb) {
  var key = String(body.key || '').trim().toUpperCase();
  var deviceId = String(body.deviceId || '').trim();
  if (!key) return cb({ ok: false, error: 'BAD_KEY' });
  if (!deviceId) return cb({ ok: false, error: 'BAD_DEVICE' });
  if (!rateOk(key + '|' + deviceId)) return cb({ ok: false, error: 'RATE' });

  store.getKey(key).then(function (rec) {
    if (!rec) return cb({ ok: false, error: 'BAD_KEY' });
    if (rec.revoked) return cb({ ok: false, error: 'REVOKED' });
    var now = Date.now();

    function issue() {
      var exp = null;
      if (rec.plan !== 'lifetime') {
        var days = parseInt(rec.plan, 10) || 0;
        exp = (rec.activatedAt || now) + days * DAY;
        if (now >= exp) return cb({ ok: false, error: 'EXPIRED', expiresAt: exp });
      }
      var payload = { d: deviceId, iat: now, chk: now + CHECK_DAYS * DAY, k: key };
      if (exp) payload.exp = exp;
      cb({ ok: true, token: sign(payload) });
    }

    if (!rec.deviceId) {
      rec.deviceId = deviceId;
      rec.deviceName = String(body.deviceName || '').slice(0, 120);
      rec.activatedAt = now;
      store.putKey(key, rec).then(issue, function () { cb({ ok: false, error: 'RATE' }); });
    } else if (rec.deviceId !== deviceId) {
      cb({ ok: false, error: 'DEVICE_LIMIT' });
    } else {
      issue();
    }
  }, function () { cb({ ok: false, error: 'RATE' }); });   // store blip -> clients fall back to offline token
}

function handleUpdate(body, cb) { cb({ ok: true, update: false }); }

/* ---------- admin ---------- */
function handleAdmin(url, body, cb) {
  if (url === '/api/admin/list') {
    return store.allKeys().then(function (keys) { cb({ ok: true, keys: keys }); }, function () { cb({ ok: false, error: 'STORE' }); });
  }
  if (url === '/api/admin/revoke' || url === '/api/admin/unbind') {
    var k = String(body.key || '').trim().toUpperCase();
    if (!k) return cb({ ok: false, error: 'NO_KEY' });
    return store.getKey(k).then(function (rec) {
      if (!rec) return cb({ ok: false, error: 'BAD_KEY' });
      if (url === '/api/admin/revoke') rec.revoked = true;
      else { rec.deviceId = null; rec.deviceName = null; rec.activatedAt = null; rec.revoked = false; }
      store.putKey(k, rec).then(function () { cb({ ok: true, key: k }); }, function () { cb({ ok: false, error: 'STORE' }); });
    }, function () { cb({ ok: false, error: 'STORE' }); });
  }
  if (url === '/api/admin/newkey') {
    var planArg = body.plan === undefined ? 'lifetime' : String(body.plan);
    var plan = (planArg === 'lifetime') ? 'lifetime' : String(parseInt(planArg, 10) || 0);
    if (plan !== 'lifetime' && plan === '0') return cb({ ok: false, error: 'BAD_PLAN' });
    var note = String(body.note || '').slice(0, 120);
    var count = Math.min(100, Math.max(1, parseInt(body.count, 10) || 1));
    var made = [];
    (function one(i) {
      if (i >= count) return cb({ ok: true, keys: made, plan: plan });
      var k = newKey();
      store.getKey(k).then(function (exists) {
        if (exists) return one(i);
        var rec = { plan: plan, deviceId: null, deviceName: null, activatedAt: null, revoked: false, note: note };
        store.putKey(k, rec).then(function () { made.push(k); one(i + 1); }, function () { cb({ ok: false, error: 'STORE' }); });
      }, function () { cb({ ok: false, error: 'STORE' }); });
    })(0);
    return;
  }
  cb({ ok: false, error: 'NOT_FOUND' });
}

/* ---------- http ---------- */
var CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,x-admin-token'
};
function send(res, code, obj) {
  var s = JSON.stringify(obj);
  res.writeHead(code, Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(s) }, CORS));
  res.end(s);
}
function readBody(req, cb) {
  var chunks = [], n = 0;
  req.on('data', function (c) { n += c.length; if (n > 1e6) req.destroy(); chunks.push(c); });
  req.on('end', function () { try { cb(null, JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { cb(e); } });
  req.on('error', cb);
}

function handler(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method === 'GET' && (req.url === '/admin' || req.url === '/admin.html')) {
    try {
      var html = fs.readFileSync(path.join(__dirname, 'admin.html'));
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': html.length });
      return res.end(html);
    } catch (e) { return send(res, 404, { ok: false, error: 'NO_ADMIN_PAGE' }); }
  }
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health')) {
    return send(res, 200, { ok: true, service: 'voicegate', store: store.backend, checkDays: CHECK_DAYS });
  }
  var isAdmin = req.url.indexOf('/api/admin/') === 0;
  if (isAdmin) {
    if (!ADMIN_TOKEN || req.headers['x-admin-token'] !== ADMIN_TOKEN) return send(res, 401, { ok: false, error: 'UNAUTHORIZED' });
    if (req.method === 'GET' && req.url === '/api/admin/list') return handleAdmin(req.url, {}, function (r) { send(res, 200, r); });
    if (req.method !== 'POST') return send(res, 404, { ok: false, error: 'NOT_FOUND' });
    return readBody(req, function (err, body) {
      if (err) return send(res, 400, { ok: false, error: 'BAD_BODY' });
      handleAdmin(req.url, body, function (r) { send(res, 200, r); });
    });
  }
  if (req.method !== 'POST') return send(res, 404, { ok: false, error: 'NOT_FOUND' });
  readBody(req, function (err, body) {
    if (err) return send(res, 400, { ok: false, error: 'BAD_RESPONSE' });
    if (req.url === '/api/validate') return handleValidate(body, function (r) { send(res, 200, r); });
    if (req.url === '/api/update') return handleUpdate(body, function (r) { send(res, 200, r); });
    send(res, 404, { ok: false, error: 'NOT_FOUND' });
  });
}

// Vercel / serverless: export the request handler.
module.exports = handler;

// Local / any Node host (Render, Koyeb, a PC): start a real server.
if (require.main === module) {
  http.createServer(handler).listen(PORT, function () {
    console.log('Voice Gate server on port ' + PORT + ' | store=' + store.backend + ' | re-check every ' + CHECK_DAYS + ' days');
  });
}
