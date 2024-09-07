import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const packagesDir = resolve(process.cwd(), 'packages');

readdirSync(packagesDir).forEach((packageName) => {
  const packagePath = join(packagesDir, packageName);
  if (statSync(packagePath).isDirectory()) {
    console.log(`Installing dependencies for ${packageName}...`);
    execSync('npm install', { cwd: packagePath, stdio: 'inherit' });
  }
});
