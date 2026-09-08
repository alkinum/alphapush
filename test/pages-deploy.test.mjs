import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('Pages preparation packages the Worker and removes Astro deployment config redirects', t => {
  const root = mkdtempSync(join(tmpdir(), 'alphapush-pages-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['dist/client', 'dist/server/chunks', '.wrangler/deploy']) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  const pagesConfig = JSON.stringify({ name: 'alphapush', pages_build_output_dir: './dist/pages' });
  writeFileSync(join(root, 'wrangler.jsonc'), pagesConfig);
  writeFileSync(join(root, 'dist/client/sw.js'), 'self.addEventListener("push", () => {});');
  writeFileSync(join(root, 'dist/server/entry.mjs'), 'export { default } from "./chunks/app.mjs";');
  writeFileSync(join(root, 'dist/server/chunks/app.mjs'), 'export default { fetch() { return new Response("ok"); } };');
  writeFileSync(join(root, 'dist/server/wrangler.json'), JSON.stringify({ assets: { binding: 'ASSETS' } }));
  const script = fileURLToPath(new URL('../scripts/prepare-pages-deploy.mjs', import.meta.url));

  for (let run = 0; run < 2; run++) {
    writeFileSync(join(root, '.wrangler/deploy/config.json'), JSON.stringify({ configPath: '../../dist/server/wrangler.json' }));
    execFileSync(process.execPath, [script], { cwd: root, stdio: 'pipe' });
    assert.equal(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'), pagesConfig);
    assert.equal(existsSync(join(root, '.wrangler/deploy/config.json')), false);
    assert.equal(existsSync(join(root, 'dist/pages/_worker.js/wrangler.json')), false);
    assert.equal(existsSync(join(root, 'dist/pages/_worker.js/entry.mjs')), false);
    assert.equal(existsSync(join(root, 'dist/server/entry.mjs')), true);
    for (const [source, output] of [['dist/client/sw.js', 'dist/pages/sw.js'], ['dist/server/entry.mjs', 'dist/pages/_worker.js/index.js'], ['dist/server/chunks/app.mjs', 'dist/pages/_worker.js/chunks/app.mjs']]) {
      assert.equal(readFileSync(join(root, output), 'utf8'), readFileSync(join(root, source), 'utf8'));
    }
  }
});

test('the Pages template uses supported environments and the development migration targets preview', () => {
  const config = JSON.parse(readFileSync(new URL('../wrangler.template.jsonc', import.meta.url), 'utf8'));
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(config.pages_build_output_dir, './dist/pages');
  assert.equal('account_id' in config, false);
  assert.equal('assets' in config, false);
  assert.deepEqual(Object.keys(config.env), ['preview']);
  assert.match(pkg.scripts['db:migrate:dev'], /--env preview(?:\s|$)/);
  for (const environment of [config, config.env.preview]) {
    assert.equal(environment.d1_databases[0].binding, 'DB');
    assert.deepEqual(environment.kv_namespaces.map(namespace => namespace.binding).sort(), ['KV', 'SESSION']);
  }
});
