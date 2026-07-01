#!/usr/bin/env node
/**
 * Smoke test for deploy/lint.mjs (AC10). No test framework — kept
 * dependency-free, same as the lint script itself.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintDir } from './lint.mjs';

// 1. The real manifests must pass as shipped.
const realDir = fileURLToPath(new URL('./k8s', import.meta.url));
const realErrors = lintDir(realDir);
assert.deepEqual(
  realErrors,
  [],
  `expected the real manifests to pass, got: ${realErrors.join('; ')}`,
);

// 2. A manifest with an Ingress must fail.
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'deploy-lint-'));
  try {
    writeFileSync(
      path.join(tmp, 'bad-ingress.yaml'),
      'apiVersion: networking.k8s.io/v1\nkind: Ingress\nmetadata:\n  name: oops\n',
    );
    const errors = lintDir(tmp);
    assert.ok(
      errors.some((e) => e.includes('Ingress')),
      'expected an Ingress manifest to be flagged',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// 3. A LoadBalancer Service must fail.
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'deploy-lint-'));
  try {
    writeFileSync(
      path.join(tmp, 'bad-svc.yaml'),
      'apiVersion: v1\nkind: Service\nmetadata:\n  name: oops\nspec:\n  type: LoadBalancer\n',
    );
    const errors = lintDir(tmp);
    assert.ok(
      errors.some((e) => e.includes('LoadBalancer')),
      'expected a LoadBalancer Service to be flagged',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// 4. A directory missing a NetworkPolicy must fail, even if everything else
//    is fine.
{
  const tmp = mkdtempSync(path.join(tmpdir(), 'deploy-lint-'));
  try {
    writeFileSync(
      path.join(tmp, 'svc.yaml'),
      'apiVersion: v1\nkind: Service\nmetadata:\n  name: ok\nspec:\n  type: ClusterIP\n',
    );
    const errors = lintDir(tmp);
    assert.ok(
      errors.some((e) => e.includes('NetworkPolicy')),
      'expected a missing NetworkPolicy to be flagged',
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('deploy/lint.test.mjs: all assertions passed');
