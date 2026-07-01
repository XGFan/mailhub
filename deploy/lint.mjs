#!/usr/bin/env node
/**
 * deploy-lint (AC10): scans a directory of k8s manifests and fails if any of
 * them would expose the portal publicly. The portal has no application
 * authentication (plan §3 invariant 1), so this lint is the enforcement
 * mechanism: no `kind: Ingress`, no `type: LoadBalancer` Service — and a
 * `ClusterIP` Service plus a `NetworkPolicy` must be present.
 *
 * Dependency-free on purpose (no yaml parser): these are our own manifests
 * and simple, so a text scan over `---`-separated documents is enough. This
 * is a best-effort guard, not a full k8s schema validator.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_K8S_DIR = fileURLToPath(new URL('./k8s', import.meta.url));

function listYamlFiles(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => path.join(dir, f));
}

/** Split a multi-document YAML file into its `---`-separated documents. */
function splitDocs(text) {
  return text
    .split(/^---\s*$/m)
    .map((d) => d.trim())
    .filter(Boolean);
}

/** Find a top-level-ish `field: value` scalar in a YAML document. */
function findField(doc, field) {
  const re = new RegExp(`^\\s*${field}:\\s*['"]?([\\w.-]+)['"]?\\s*(#.*)?$`, 'm');
  const m = doc.match(re);
  return m ? m[1] : undefined;
}

/**
 * Lint every *.yaml/*.yml manifest in `dir`. Returns an array of violation
 * strings — empty means pass.
 */
export function lintDir(dir) {
  const errors = [];
  let files;
  try {
    files = listYamlFiles(dir);
  } catch (err) {
    return [`cannot read manifest directory ${dir}: ${err.message}`];
  }
  if (files.length === 0) {
    return [`no manifests found in ${dir}`];
  }

  let hasClusterIPService = false;
  let hasNetworkPolicy = false;

  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const doc of splitDocs(text)) {
      const kind = findField(doc, 'kind');
      if (!kind) continue;

      if (kind === 'Ingress') {
        errors.push(
          `${path.basename(file)}: kind: Ingress is forbidden — no public Ingress by design (AC10)`,
        );
      }

      if (kind === 'Service') {
        // ClusterIP is the k8s default when `type` is omitted.
        const type = findField(doc, 'type') ?? 'ClusterIP';
        if (type === 'LoadBalancer') {
          errors.push(
            `${path.basename(file)}: Service type: LoadBalancer is forbidden (AC10)`,
          );
        }
        if (type === 'ClusterIP') hasClusterIPService = true;
      }

      if (kind === 'NetworkPolicy') hasNetworkPolicy = true;
    }
  }

  if (!hasClusterIPService) {
    errors.push(`no Service of type ClusterIP found in ${dir}`);
  }
  if (!hasNetworkPolicy) {
    errors.push(`no NetworkPolicy found in ${dir}`);
  }

  return errors;
}

function main() {
  const dir = process.argv[2] ?? DEFAULT_K8S_DIR;
  const errors = lintDir(dir);
  if (errors.length > 0) {
    console.error('deploy-lint: FAILED');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`deploy-lint: OK (${dir})`);
}

// Run when invoked directly (`node lint.mjs`), not when imported by the test.
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main();
}
