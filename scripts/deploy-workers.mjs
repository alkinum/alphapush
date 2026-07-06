#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = resolve(__dirname, '..');
const DEFAULT_ENV = 'production';
const ALLOWED_ENVS = new Set(['production', 'local']);

function printUsage() {
  console.log(`
Usage:
  node scripts/deploy-workers.mjs --list
  node scripts/deploy-workers.mjs --all [--env production|local] [--dry-run]
  node scripts/deploy-workers.mjs --worker <name> [--worker <name> ...] [--env production|local] [--dry-run]

Examples:
  node scripts/deploy-workers.mjs --list
  node scripts/deploy-workers.mjs --all
  node scripts/deploy-workers.mjs --worker delivery-retries --env production
  node scripts/deploy-workers.mjs --worker delivery-retries --env production --dry-run
`.trim());
}

function discoverWorkers() {
  const workers = new Set();

  for (const name of readdirSync(projectRoot)) {
    const templateMatch = /^wrangler\.(.+)\.template\.toml$/.exec(name);
    if (templateMatch) {
      workers.add(templateMatch[1]);
      continue;
    }

    const configMatch = /^wrangler\.(.+)\.toml$/.exec(name);
    if (configMatch) {
      workers.add(configMatch[1]);
    }
  }

  return Array.from(workers).sort();
}

function parseWorkerArg(value) {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const options = {
    all: false,
    dryRun: false,
    list: false,
    env: DEFAULT_ENV,
    workers: [],
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--all') {
      options.all = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--list') {
      options.list = true;
      continue;
    }

    if (arg === '--env') {
      const value = argv[i + 1];
      if (!value || !ALLOWED_ENVS.has(value)) {
        throw new Error('--env requires one of: production | local');
      }
      options.env = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--env=')) {
      const value = arg.slice('--env='.length);
      if (!ALLOWED_ENVS.has(value)) {
        throw new Error('--env requires one of: production | local');
      }
      options.env = value;
      continue;
    }

    if (arg === '--worker') {
      const value = argv[i + 1];
      if (!value) {
        throw new Error('--worker requires a value');
      }
      options.workers.push(...parseWorkerArg(value));
      i += 1;
      continue;
    }

    if (arg.startsWith('--worker=')) {
      options.workers.push(...parseWorkerArg(arg.slice('--worker='.length)));
      continue;
    }

    if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function getConfigPath(worker) {
  return resolve(projectRoot, `wrangler.${worker}.toml`);
}

function getTemplatePath(worker) {
  return resolve(projectRoot, `wrangler.${worker}.template.toml`);
}

function getReadableConfigPath(worker) {
  const configPath = getConfigPath(worker);
  if (existsSync(configPath)) {
    return configPath;
  }

  const templatePath = getTemplatePath(worker);
  if (existsSync(templatePath)) {
    return templatePath;
  }

  throw new Error(`Unknown worker "${worker}" (${configPath} not found)`);
}

function parseWorkerNames(worker) {
  const configPath = getReadableConfigPath(worker);
  const content = readFileSync(configPath, 'utf8');
  let section = '';
  let topLevelName = '';
  let productionName = '';

  for (const rawLine of content.split(/\r?\n/g)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const sectionMatch = /^\[([^\]]+)\]$/.exec(line);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }

    const nameMatch = /^name\s*=\s*["']([^"']+)["']/.exec(line);
    if (!nameMatch) continue;

    if (section === 'env.production') {
      productionName = nameMatch[1];
    } else if (!section) {
      topLevelName = nameMatch[1];
    }
  }

  return {
    topLevelName,
    productionName: productionName || topLevelName,
  };
}

function getDeployArgs(worker, env) {
  const args = ['exec', 'wrangler', 'deploy', '-c', `wrangler.${worker}.toml`];
  if (env === 'production') {
    args.push('--env', 'production');
  }
  return args;
}

function isDeployableWorkerName(name) {
  return /^[a-z0-9][a-z0-9-]*$/.test(name) &&
    !name.startsWith('your-') &&
    !name.includes('example') &&
    !name.includes('template');
}

function deployWorker(worker, env, dryRun) {
  const configPath = getConfigPath(worker);
  if (!existsSync(configPath)) {
    const templatePath = getTemplatePath(worker);
    if (existsSync(templatePath)) {
      const message = `Missing local Wrangler config for "${worker}". Copy ${templatePath} to ${configPath} and fill deployment-specific values.`;
      if (dryRun) {
        console.log(`[deploy] ${message}`);
        return;
      }

      throw new Error(message);
    }

    throw new Error(`Unknown worker "${worker}" (${configPath} not found)`);
  }

  const workerNames = parseWorkerNames(worker);
  const targetName = env === 'production' ? workerNames.productionName : workerNames.topLevelName;
  if (!targetName || !isDeployableWorkerName(targetName)) {
    throw new Error(`Refusing to deploy worker with unsafe name: ${targetName || '(missing)'}`);
  }

  const args = getDeployArgs(worker, env);
  console.log(`[deploy] ${targetName}: pnpm ${args.join(' ')}`);

  if (dryRun) {
    return;
  }

  const result = spawnSync('pnpm', args, {
    cwd: projectRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    throw new Error(`Failed to deploy worker "${worker}"`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const availableWorkers = discoverWorkers();

  if (options.list) {
    for (const worker of availableWorkers) {
      const names = parseWorkerNames(worker);
      const configStatus = existsSync(getConfigPath(worker)) ? 'configured' : 'template-only';
      console.log(`${worker}\t${configStatus}\tlocal=${names.topLevelName}\tproduction=${names.productionName}`);
    }
    return;
  }

  const requestedWorkers = options.all ? availableWorkers : Array.from(new Set(options.workers));
  if (requestedWorkers.length === 0) {
    printUsage();
    return;
  }

  for (const worker of requestedWorkers) {
    if (!availableWorkers.includes(worker)) {
      throw new Error(`Unknown worker "${worker}". Available: ${availableWorkers.join(', ') || '(none)'}`);
    }
  }

  for (const worker of requestedWorkers) {
    deployWorker(worker, options.env, options.dryRun);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
