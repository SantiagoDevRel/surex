// The trust test. If these pass, running the fixture cannot read a real secret
// or reach a real host. This is what lets anyone run it without inspecting it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import {
  PACKAGE_ROOT,
  FIXTURE_HOME,
  DECOY_CREDENTIAL_PATH,
  DEFAULT_SINK,
  sinkUrl,
  isLoopbackHost,
  assertInsidePackage,
  assertLoopbackSink,
  ensureDecoys,
} from '../src/safety.mjs';

test('the decoy credential path resolves INSIDE the package directory', () => {
  const resolved = path.resolve(DECOY_CREDENTIAL_PATH);
  assert.ok(
    resolved.startsWith(PACKAGE_ROOT + path.sep),
    `decoy credential ${resolved} must be under ${PACKAGE_ROOT}`,
  );
});

test('the real ~/.ssh/id_rsa is never the target', () => {
  const realKey = path.resolve(path.join(os.homedir(), '.ssh', 'id_rsa'));
  assert.notEqual(path.resolve(DECOY_CREDENTIAL_PATH), realKey);
});

test('the default outbound sink is not a real remote host', () => {
  assert.ok(isLoopbackHost(DEFAULT_SINK), `${DEFAULT_SINK} must be loopback`);
  assert.ok(isLoopbackHost(sinkUrl()), 'the effective sink must be loopback by default');
});

test('isLoopbackHost accepts loopback and rejects real hosts', () => {
  for (const ok of [
    'http://127.0.0.1:9/x',
    'http://localhost:8080',
    'http://[::1]:9',
    'http://sink.invalid/x',
    'http://foo.localhost/x',
  ]) {
    assert.ok(isLoopbackHost(ok), `${ok} should be loopback`);
  }
  for (const bad of [
    'http://example.com',
    'http://8.8.8.8',
    'https://evil.attacker.net/collect',
    'http://169.254.169.254/latest', // cloud metadata is NOT loopback
    'not a url',
  ]) {
    assert.ok(!isLoopbackHost(bad), `${bad} should NOT be loopback`);
  }
});

test('assertLoopbackSink throws on a real host', () => {
  assert.throws(() => assertLoopbackSink('https://evil.attacker.net'), /non-loopback/);
  assert.doesNotThrow(() => assertLoopbackSink('http://127.0.0.1:9/x'));
});

test('assertInsidePackage refuses paths outside the package', () => {
  assert.throws(() => assertInsidePackage(path.join(PACKAGE_ROOT, '..', 'escape.txt')), /outside the package/);
  assert.throws(() => assertInsidePackage(os.homedir()), /outside the package/);
  assert.doesNotThrow(() => assertInsidePackage(path.join(FIXTURE_HOME, 'notes', 'onboarding.md')));
});

test('ensureDecoys writes only inside FIXTURE_HOME and produces the decoy key', () => {
  ensureDecoys();
  assert.ok(fs.existsSync(DECOY_CREDENTIAL_PATH));
  const body = fs.readFileSync(DECOY_CREDENTIAL_PATH, 'utf8');
  // The key is obviously fake.
  assert.match(body, /FAKE-DECOY-KEY/);
  assert.ok(path.resolve(DECOY_CREDENTIAL_PATH).startsWith(FIXTURE_HOME + path.sep));
});
