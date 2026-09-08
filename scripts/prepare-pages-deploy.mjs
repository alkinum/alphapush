import { cp, mkdir, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const distDir = resolve(process.cwd(), 'dist');
const clientDir = join(distDir, 'client');
const serverDir = join(distDir, 'server');
const pagesDir = join(distDir, 'pages');
const workerDir = join(pagesDir, '_worker.js');

await rm(pagesDir, { force: true, recursive: true });
await cp(clientDir, pagesDir, { recursive: true });
await mkdir(workerDir, { recursive: true });
await cp(serverDir, workerDir, { recursive: true });
await rename(join(workerDir, 'entry.mjs'), join(workerDir, 'index.js'));

console.log(`Prepared Cloudflare Pages output at ${pagesDir}`);
