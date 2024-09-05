import { execSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const packagesDir = resolve(process.cwd(), 'packages');

console.log('Building packages...');

readdirSync(packagesDir).forEach((packageName) => {
  const packagePath = join(packagesDir, packageName);
  if (statSync(packagePath).isDirectory()) {
    console.log(`Building ${packageName}...`);
    try {
      execSync('npm run build', { cwd: packagePath, stdio: 'inherit' });
      console.log(`Successfully built ${packageName}`);
    } catch (error) {
      console.error(`Error building ${packageName}:`, error.message);
      process.exit(1);
    }
  }
});

console.log('All packages built successfully.');
