'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const getDashboardUrl = require('./dashboardUrl');

function withEnvironment(values, callback) {
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return callback();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('dashboard link uses the configured public URL and preserves deployment path', () => {
  withEnvironment({ DASHBOARD_URL: 'https://panel.example.test/tenant?unused=1#part', RENDER_EXTERNAL_URL: 'https://render.example.test' }, () => {
    assert.equal(getDashboardUrl(), 'https://panel.example.test/tenant/dashboard');
  });
  withEnvironment({ DASHBOARD_URL: 'https://panel.example.test/tenant/dashboard/', RENDER_EXTERNAL_URL: undefined }, () => {
    assert.equal(getDashboardUrl(), 'https://panel.example.test/tenant/dashboard');
  });
  withEnvironment({ DASHBOARD_URL: undefined, RENDER_EXTERNAL_URL: 'https://render.example.test' }, () => {
    assert.equal(getDashboardUrl(), 'https://render.example.test/dashboard');
  });
});

test('invalid dashboard URL safely falls back to the official site', () => {
  withEnvironment({ DASHBOARD_URL: 'javascript:alert(1)', RENDER_EXTERNAL_URL: undefined }, () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      assert.equal(getDashboardUrl(), `${getDashboardUrl.OFFICIAL_SITE_URL}/dashboard`);
    } finally {
      console.error = originalError;
    }
  });
});
