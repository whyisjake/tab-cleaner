// Builds dist/ with the real packaging scripts and checks that every local
// file the manifest and extension pages reference landed at the path they
// reference. An unpacked load reads from the repo root, so a file missing from
// the copy-files allowlist only breaks the store package.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const PAGES = ['popup.html', 'options.html'];

const { scripts } = require('../package.json');
const manifest = require('../manifest.json');

// Local href/src targets in an HTML file, without #fragment or ?query
function localReferences(html) {
  const refs = [...html.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/g)].map(match => match[1]);
  return refs
    .filter(ref => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref))
    .map(ref => ref.split(/[?#]/)[0])
    .filter(Boolean);
}

function manifestReferences() {
  return [
    manifest.background.service_worker,
    manifest.options_page,
    manifest.action.default_popup,
    ...Object.values(manifest.icons)
  ];
}

describe('store package', () => {
  before(() => {
    execSync(scripts.clean, { cwd: ROOT, stdio: 'pipe' });
    execSync(scripts['copy-files'], { cwd: ROOT, stdio: 'pipe', shell: '/bin/sh' });
  });

  it('includes every file the manifest references', () => {
    const missing = manifestReferences().filter(ref => !fs.existsSync(path.join(DIST, ref)));
    assert.deepEqual(missing, [], `missing from dist/: ${missing.join(', ')}`);
  });

  for (const page of PAGES) {
    it(`includes every local file ${page} references`, () => {
      const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
      const missing = localReferences(html).filter(ref => !fs.existsSync(path.join(DIST, ref)));
      assert.deepEqual(missing, [], `${page} references files missing from dist/: ${missing.join(', ')}`);
    });
  }

  it('ignores remote URLs, fragments and queries when collecting references', () => {
    const html = [
      '<link rel="stylesheet" href="ui.css?v=2">',
      '<a href="https://github.com/whyisjake">GitHub</a>',
      '<a href="mailto:someone@example.com">Mail</a>',
      '<a href="#main">Skip</a>',
      '<svg><use href="icons/social.svg#github"></use></svg>',
      '<img src="data:image/png;base64,AAAA">'
    ].join('\n');

    assert.deepEqual(localReferences(html), ['ui.css', 'icons/social.svg']);
  });
});
