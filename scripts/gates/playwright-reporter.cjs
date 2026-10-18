const fs = require('node:fs');
const path = require('node:path');

// The report is produced by Playwright's actual begin/end callbacks. Selected
// test titles and outcomes are checked; --list alone cannot produce success.
module.exports = class GatePlaywrightReporter {
  onBegin(config, suite) {
    this.expected = suite.allTests().map(test => ({ id: test.id, title: test.titlePath().join(' > ') }));
    this.results = [];
  }
  onTestEnd(test, result) {
    this.results.push({ id: test.id, title: test.titlePath().join(' > '), status: result.status,
      expectedStatus: test.expectedStatus, retry: result.retry, duration: result.duration });
  }
  onEnd(result) {
    const destination = process.env.DEV_SESSION_CANVAS_PLAYWRIGHT_RECEIPT;
    if (!destination) throw new Error('Gate Playwright reporter needs its fixed output');
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, JSON.stringify({ schemaVersion: 1, status: result.status,
      expected: this.expected, results: this.results }, null, 2));
  }
};
