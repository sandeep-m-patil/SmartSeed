// Generates test-vectors/canonical-hash.json.
// The `canonical` strings are written BY HAND from RFC 8785 rules (not produced by the
// implementation under test); only the SHA-256 is computed here, with node:crypto directly.
// Backend (Node) tests must reuse this file to prove hash parity with the chaincode.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

// `inputJson` is the raw JSON text; consumers must JSON.parse it, then canonicalize + hash.
const cases = [
  { name: 'key-ordering', inputJson: '{"b":2,"a":1}', canonical: '{"a":1,"b":2}' },
  {
    name: 'nested-and-whitespace',
    inputJson: '{ "z": [3, 1, {"y": null, "x": true}],\n  "a": "s" }',
    canonical: '{"a":"s","z":[3,1,{"x":true,"y":null}]}',
  },
  {
    name: 'number-formatting',
    inputJson: '[1.0, 1e21, 0.000001, 1e-7, -0, 100, 4.5, 1E2]',
    canonical: '[1,1e+21,0.000001,1e-7,0,100,4.5,100]',
  },
  {
    name: 'string-escapes',
    inputJson: '{"a\\n":"\\u0001\\"\\\\\\/","\\u00e9":"\\u20ac"}',
    canonical: '{"a\\n":"\\u0001\\"\\\\/","é":"€"}',
  },
  {
    name: 'utf16-key-order',
    inputJson: '{"\\uffff":2,"\\ud83d\\ude00":1,"b":0}',
    canonical: '{"b":0,"😀":1,"￿":2}',
  },
  { name: 'empty-containers', inputJson: '{"b":[],"a":{}}', canonical: '{"a":{},"b":[]}' },
  {
    name: 'event-record',
    inputJson:
      '{"eventType":"TRANSFER_INITIATED","batchId":"B-2026-0001","ts":1767225600000,' +
      '"quantityCommitment":"' + 'ab'.repeat(32) + '","fromOrgHash":null}',
    canonical:
      '{"batchId":"B-2026-0001","eventType":"TRANSFER_INITIATED","fromOrgHash":null,' +
      '"quantityCommitment":"' + 'ab'.repeat(32) + '","ts":1767225600000}',
  },
].map((c) => ({ ...c, expectedHash: sha256(c.canonical) }));

// Quantity commitment = SHA-256 of "<quantity>|<salt>" (UTF-8), lowercase hex.
const quantityCommitments = [
  { quantity: '5000', salt: 'salt-0001' },
  { quantity: '1', salt: 'c0ffee' },
].map((c) => ({ ...c, preimage: `${c.quantity}|${c.salt}`, expectedCommitment: sha256(`${c.quantity}|${c.salt}`) }));

const out = {
  description: 'Canonical JSON (RFC 8785 style) + SHA-256 parity vectors for SmartSeed chaincode and backend',
  algorithm: 'sha256(utf8(canonicalize(JSON.parse(inputJson)))) as lowercase hex',
  cases,
  quantityCommitments,
};
const target = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-vectors', 'canonical-hash.json');
writeFileSync(target, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${cases.length} vectors to ${target}`);
