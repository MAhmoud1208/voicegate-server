'use strict';
/* Voice Gate - key store with two backends:
 *   - Upstash Redis (persistent, free) when UPSTASH_REDIS_REST_URL + _TOKEN are set
 *   - local data/keys.json otherwise (for local runs / testing)
 * Both server.js and newkey.js use this so keys live in one place.
 *
 * API (all return Promises):
 *   getKey(k)        -> record | null
 *   putKey(k, rec)   -> rec
 *   allKeys()        -> { KEY: record, ... }
 */
var fs = require('fs');
var path = require('path');
var https = require('https');

var DATA = path.join(__dirname, 'data');
var KEYS_FILE = path.join(DATA, 'keys.json');
var PREFIX = 'vg:key:';
var INDEX = 'vg:keys';

var UP_URL = process.env.UPSTASH_REDIS_REST_URL || '';
var UP_TOK = process.env.UPSTASH_REDIS_REST_TOKEN || '';
var useRedis = !!(UP_URL && UP_TOK);

/* ---------- Upstash REST ---------- */
function redis(commandOrPipeline, isPipeline) {
  return new Promise(function (resolve, reject) {
    var u;
    try { u = new URL(UP_URL.replace(/\/+$/, '') + (isPipeline ? '/pipeline' : '')); }
    catch (e) { return reject(new Error('BAD_UPSTASH_URL')); }
    var data = Buffer.from(JSON.stringify(commandOrPipeline));
    var req = https.request({
      method: 'POST', hostname: u.hostname, port: 443, path: u.pathname,
      headers: { 'Authorization': 'Bearer ' + UP_TOK, 'Content-Type': 'application/json', 'Content-Length': data.length }
    }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        try {
          var j = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (j && j.error) return reject(new Error(j.error));
          resolve(j);
        } catch (e) { reject(new Error('BAD_REDIS_RESPONSE')); }
      });
    });
    req.setTimeout(12000, function () { req.destroy(new Error('REDIS_TIMEOUT')); });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

/* ---------- local file ---------- */
function fileRead() { try { return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); } catch (e) { return { keys: {} }; } }
function fileWrite(db) { try { fs.mkdirSync(DATA, { recursive: true }); } catch (e) {} fs.writeFileSync(KEYS_FILE, JSON.stringify(db, null, 2)); }

/* ---------- unified API ---------- */
function getKey(k) {
  if (!useRedis) { return Promise.resolve(fileRead().keys[k] || null); }
  return redis(['GET', PREFIX + k]).then(function (r) {
    return (r && r.result) ? JSON.parse(r.result) : null;
  });
}
function putKey(k, rec) {
  if (!useRedis) { var db = fileRead(); db.keys[k] = rec; fileWrite(db); return Promise.resolve(rec); }
  return redis([['SET', PREFIX + k, JSON.stringify(rec)], ['SADD', INDEX, k]], true).then(function () { return rec; });
}
function allKeys() {
  if (!useRedis) { return Promise.resolve(fileRead().keys); }
  return redis(['SMEMBERS', INDEX]).then(function (r) {
    var ks = (r && r.result) || [];
    if (!ks.length) return {};
    return redis(ks.map(function (k) { return ['GET', PREFIX + k]; }), true).then(function (arr) {
      var out = {};
      (arr || []).forEach(function (row, i) { if (row && row.result) { try { out[ks[i]] = JSON.parse(row.result); } catch (e) {} } });
      return out;
    });
  });
}

module.exports = { getKey: getKey, putKey: putKey, allKeys: allKeys, backend: useRedis ? 'upstash' : 'file' };
