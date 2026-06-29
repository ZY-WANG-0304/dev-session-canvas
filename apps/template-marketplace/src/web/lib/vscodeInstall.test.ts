import { describe, expect, it } from 'vitest';

import { buildVSCodeInstallHref } from './vscodeInstall';

describe('marketplace VSCode install links', () => {
  it('builds extension URI links with preview source and explicit version', () => {
    const href = buildVSCodeInstallHref(
      {
        slug: 'review-loop',
        latestVersion: { id: 'tmpl-review-loop-v1' }
      },
      'https://dscanvas-template-marketplace.wzy0304.workers.dev'
    );

    expect(href).toBe(
      'vscode://devsessioncanvas.dev-session-canvas/install-template?template=review-loop&version=tmpl-review-loop-v1&source=https%3A%2F%2Fdscanvas-template-marketplace.wzy0304.workers.dev%2Ftemplates%2Freview-loop'
    );
  });

  it('encodes unsafe slugs inside both URI query and source URL', () => {
    const href = buildVSCodeInstallHref(
      {
        slug: 'team/review loop',
        latestVersion: { id: 'version with spaces' }
      },
      'https://dscanvas.dev/templates'
    );

    expect(href).toBe(
      'vscode://devsessioncanvas.dev-session-canvas/install-template?template=team%2Freview+loop&version=version+with+spaces&source=https%3A%2F%2Fdscanvas.dev%2Ftemplates%2Fteam%252Freview%2520loop'
    );
  });

  it('does not include inline payload parameters in external install links', () => {
    const href = buildVSCodeInstallHref(
      {
        id: 'tmpl-review-loop',
        slug: 'review-loop',
        latestVersion: {
          id: 'tmpl-review-loop-v1',
          versionNumber: 1,
          sha256: '005e90644dae8084a612d6a9d2e198508618eaa792648eb19bc56113cbcc4e92',
          sizeBytes: 1897
        }
      },
      'https://dscanvas-template-marketplace.wzy0304.workers.dev',
    );

    expect(href).not.toContain('payload=');
    expect(href).not.toContain('payloadSha256=');
    expect(href).toBe(
      'vscode://devsessioncanvas.dev-session-canvas/install-template?template=review-loop&version=tmpl-review-loop-v1&source=https%3A%2F%2Fdscanvas-template-marketplace.wzy0304.workers.dev%2Ftemplates%2Freview-loop'
    );
  });
});
