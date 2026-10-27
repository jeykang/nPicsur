// Lists the known vulnerabilities in pnpm-lock.yaml, and what fixes each.
// Run it with: pnpm vulnerabilities
//
// The fixes are tried on a copy of the lockfile and the package.json files,
// nothing in the repository changes. Updates that stay within the ranges in
// package.json are tried first, in this order:
//
// 1. The vulnerable packages that are dependencies in a package.json.
// 2. Those that only other packages depend on. pnpm leaves these alone when
//    both kinds are updated at once.
// 3. The dependencies in a package.json that lead to what is still
//    vulnerable, as they can ask for an exact version of it.
// 4. Deduplicating, as pnpm does not update a package where other packages
//    depend on it when it is a dependency in a package.json as well.
//
// What is left needs a new range in a package.json, a new major version, or a
// version that the packages depending on it do not get yet.

import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const severities = ['critical', 'high', 'moderate', 'low', 'info'];

function pnpm(cwd, args) {
  const result = spawnSync('pnpm', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return result;
}

function run(cwd, args) {
  const result = pnpm(cwd, args);
  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(' ')} failed:\n${result.stderr}`);
  }
  return result.stdout;
}

// One finding per advisory and path to the vulnerable package, like
// backend > fastify > fast-uri. pnpm audit exits with 1 when it finds
// something, so its output counts as long as it is a report.
function audit(cwd, args = []) {
  const { stdout, stderr } = pnpm(cwd, ['audit', '--json', ...args]);
  let report;
  try {
    report = JSON.parse(stdout);
  } catch {
    // Not a report, the error is thrown below
  }
  if (!report?.advisories) {
    throw new Error(`pnpm audit failed:\n${stderr || stdout}`);
  }
  return Object.values(report.advisories).flatMap((advisory) =>
    advisory.findings.flatMap(({ version, paths }) =>
      paths.map((path) => ({ advisory, version, path: path.split('>') })),
    ),
  );
}

const key = ({ advisory, path }) => `${advisory.id} ${path.join('>')}`;

// The versions of every package in the lockfile in a directory
function locked(cwd) {
  const versions = new Map();
  let section;
  const lockfile = readFileSync(join(cwd, 'pnpm-lock.yaml'), 'utf8');
  for (const line of lockfile.split('\n')) {
    if (/^\S/.test(line)) section = line;
    const match =
      section === 'packages:' && line.match(/^ {2}'?(@?[^@]+)@([^(':]+)/);
    if (match) {
      versions.set(match[1], [...(versions.get(match[1]) ?? []), match[2]]);
    }
  }
  return versions;
}

// The lowest version above a vulnerable one in the patched range of an
// advisory, if any. Each part of a range like ">=1.2.3 <2.0.0 || >=2.1.0" is
// looked at on its own, as semver.minVersion gives up on the whole range when
// one part has no version above.
function fixedAbove(version, patched) {
  const versions = patched
    .split('||')
    .map((part) => semver.minVersion(`>${version} ${part.trim()}`))
    .filter(Boolean);
  return versions.length ? versions.sort(semver.compare)[0] : null;
}

function groupBy(items, by) {
  const groups = new Map();
  for (const item of items) {
    groups.set(by(item), [...(groups.get(by(item)) ?? []), item]);
  }
  return [...groups].sort(([a], [b]) => a.localeCompare(b));
}

const projects = JSON.parse(
  run(root, ['ls', '--recursive', '--depth', '-1', '--json']),
).map(({ path }) => ({
  dir: relative(root, path) || '.',
  manifest: JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')),
}));

// The ranges of the dependencies in each package.json, by name and project
const ranges = new Map();
for (const { dir, manifest } of projects) {
  for (const field of [
    'dependencies',
    'devDependencies',
    'optionalDependencies',
  ]) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (!ranges.has(name)) ranges.set(name, new Map());
      ranges.get(name).set(dir, range);
    }
  }
}

function report(copy) {
  console.error(
    'Checking for vulnerabilities and fixes, this can take a minute',
  );
  let remaining = audit(copy);
  const found = remaining;
  if (!found.length) {
    console.log('No known vulnerabilities.');
    return;
  }
  // The dependencies the backend and the shared code run with, which are in
  // the Docker image. Those of the frontend are all devDependencies, as it is
  // built.
  const production = new Set(audit(copy, ['--prod']).map(key));

  const steps = [];
  const attempt = (command, names = []) => {
    const before = locked(copy);
    run(copy, [...command, ...names, '--lockfile-only']);
    const now = audit(copy);
    const left = new Set(now.map(key));
    const fixed = remaining.filter((finding) => !left.has(key(finding)));
    // Only the packages that led to a fix, themselves or what they depend on
    const used = names.filter((name) =>
      fixed.some((f) => f.advisory.module_name === name || f.path[1] === name),
    );
    if (fixed.length) {
      const args = [...command, ...(used.length ? used : names)];
      steps.push({ args, fixed, before, after: locked(copy) });
    }
    remaining = now;
  };
  const update = (names) => {
    if (names.size) attempt(['update', '--recursive'], [...names].sort());
  };
  const vulnerable = () => [
    ...new Set(remaining.map(({ advisory }) => advisory.module_name)),
  ];

  update(new Set(vulnerable().filter((name) => ranges.has(name))));
  update(new Set(vulnerable().filter((name) => !ranges.has(name))));
  update(
    new Set(
      remaining
        .filter(({ path }) => path.length > 2)
        .map(({ path }) => path[1]),
    ),
  );
  if (remaining.length) attempt(['dedupe']);

  // There is an advisory for each vulnerable range of a package, which can
  // share the id of one advisory on GitHub
  const unique = (findings) => [
    ...new Map(
      findings.map(({ advisory }) => [
        advisory.github_advisory_id ?? advisory.id,
        advisory,
      ]),
    ).values(),
  ];
  const advisories = unique(found);
  const counts = severities
    .map((severity) => [
      severity,
      advisories.filter((advisory) => advisory.severity === severity).length,
    ])
    .filter(([, count]) => count)
    .map(([severity, count]) => `${count} ${severity}`);
  const names = new Set(advisories.map((advisory) => advisory.module_name));
  console.log(
    `${advisories.length} known vulnerabilities in ${names.size} packages: ` +
      `${counts.join(', ')}.\n` +
      'Production marks what the backend runs with, in the Docker image.\n',
  );

  const label = (findings) =>
    findings.some((finding) => production.has(key(finding)))
      ? ' (production)'
      : '';
  // The advisories of findings in one package, and where it is used
  const describe = (findings) => {
    const shown = unique(findings);
    shown.sort(
      (a, b) => severities.indexOf(a.severity) - severities.indexOf(b.severity),
    );
    for (const advisory of shown) {
      const id = advisory.github_advisory_id ?? advisory.url;
      console.log(`    ${advisory.severity.padEnd(9)}${id} ${advisory.title}`);
    }
    const paths = [...new Set(findings.map(({ path }) => path.join(' > ')))];
    paths.sort((a, b) => a.length - b.length);
    const more = paths.length > 3 ? `, and ${paths.length - 3} more` : '';
    console.log(`    via ${paths.slice(0, 3).join(', ')}${more}`);
  };

  if (steps.length) {
    console.log(
      'Fixed by these updates within the ranges in package.json, in this ' +
        'order:\n',
    );
  }
  for (const { args, fixed, before, after } of steps) {
    console.log(`  pnpm ${args.join(' ')}`);
    const fixedPackages = groupBy(fixed, (f) => f.advisory.module_name);
    for (const [name, findings] of fixedPackages) {
      const from = [...new Set(findings.map(({ version }) => version))];
      // The versions now locked without these vulnerabilities, preferably
      // those that are new
      const safe = (after.get(name) ?? []).filter(
        (version) =>
          !findings.some(({ advisory }) =>
            semver.satisfies(version, advisory.vulnerable_versions),
          ),
      );
      const added = safe.filter(
        (version) => !(before.get(name) ?? []).includes(version),
      );
      const to = added.length ? added : safe;
      console.log(
        `  ${name} ${from.sort(semver.compare).join(', ')} → ` +
          `${to.sort(semver.compare).join(', ') || 'removed'}${label(findings)}`,
      );
      describe(findings);
    }
    console.log();
  }

  // What is left, by package and version, and whether it is a dependency in
  // a package.json or of other packages
  const left = groupBy(
    remaining,
    (f) =>
      `${f.advisory.module_name}@${f.version} ${f.path.length === 2 ? 'direct' : 'indirect'}`,
  );
  if (left.length) console.log('Left to fix:\n');
  for (const [, findings] of left) {
    const { version, path } = findings[0];
    const name = findings[0].advisory.module_name;
    const patched = findings.map(({ advisory }) =>
      fixedAbove(version, advisory.patched_versions),
    );
    const fix = patched.includes(null)
      ? null
      : patched.reduce((a, b) => (semver.gt(a, b) ? a : b));
    console.log(`  ${name} ${version}${label(findings)}`);
    describe(findings);
    if (!fix) {
      console.log('    No version without these vulnerabilities is released.');
    } else if (path.length === 2) {
      if (semver.satisfies(fix, `^${version}`)) {
        for (const dir of new Set(findings.map((finding) => finding.path[0]))) {
          console.log(
            `    In ${dir}/package.json, change ${name} from ` +
              `${ranges.get(name)?.get(dir)} to ^${fix}.`,
          );
        }
      } else {
        console.log(
          `    Fixed in ${fix}, a new major version, which can need changes ` +
            'to the code.',
        );
      }
    } else {
      const parents = [
        ...new Set(findings.map((finding) => finding.path.at(-2))),
      ];
      console.log(
        `    Fixed in ${fix}, but no update within the ranges makes ` +
          `${parents.join(' and ')} use it.\n` +
          `    New versions of ${parents.join(' and ')} may, or an override ` +
          'in pnpm-workspace.yaml forces it:',
      );
      for (const parent of parents) {
        console.log(`      '${parent}>${name}': ^${fix}`);
      }
    }
    console.log();
  }
}

const copy = mkdtempSync(join(tmpdir(), 'picsur-vulnerabilities-'));
try {
  for (const file of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc']) {
    if (existsSync(join(root, file))) {
      cpSync(join(root, file), join(copy, file));
    }
  }
  // For patchedDependencies
  if (existsSync(join(root, 'patches'))) {
    cpSync(join(root, 'patches'), join(copy, 'patches'), { recursive: true });
  }
  for (const { dir } of projects) {
    mkdirSync(join(copy, dir), { recursive: true });
    cpSync(join(root, dir, 'package.json'), join(copy, dir, 'package.json'));
  }
  report(copy);
} finally {
  rmSync(copy, { recursive: true, force: true });
}
