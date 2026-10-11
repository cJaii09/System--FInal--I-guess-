const http = require('node:http');
const { after, before, test } = require('node:test');
const assert = require('node:assert/strict');

process.env.SUPABASE_URL = 'https://supabase.test';
process.env.SUPABASE_ANON_KEY = 'test-public-anon-key';
process.env.CHAT_API_KEY = '';

const { app } = require('../server');

const fixtureUsers = {
  'test-token-patient': '11111111-1111-4111-8111-111111111111',
  'test-token-payment': '22222222-2222-4222-8222-222222222222',
  'test-token-contact': '33333333-3333-4333-8333-333333333333',
  'test-token-invalid': '44444444-4444-4444-8444-444444444444'
};

let server;
let baseUrl;
const originalFetch = global.fetch;

before(async () => {
  global.fetch = async (input, options = {}) => {
    const url = new URL(input);
    const token = (options.headers && options.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (url.pathname === '/auth/v1/user') {
      if (token === 'test-token-invalid') {
        return new Response('Unauthorized', { status: 401 });
      }
      const id = fixtureUsers[token];
      return new Response(JSON.stringify({ id }), {
        status: id ? 200 : 401,
        headers: { 'content-type': 'application/json' }
      });
    }
    if (url.pathname === '/rest/v1/profiles') {
      return new Response(JSON.stringify([{ role: 'patient', hospital_id: null, suspended_at: null }]), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    throw new Error('Unexpected outbound request in chat test');
  };
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  global.fetch = originalFetch;
  await new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
});

function postChat({ token, messages }) {
  const body = JSON.stringify({ messages });
  return new Promise((resolve, reject) => {
    const request = http.request(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      }
    }, response => {
      let responseBody = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { responseBody += chunk; });
      response.on('end', () => {
        resolve({ status: response.statusCode, body: JSON.parse(responseBody) });
      });
    });
    request.on('error', reject);
    request.end(body);
  });
}

test('POST /api/chat rejects requests without a bearer token', async () => {
  const response = await postChat({ messages: [{ role: 'user', text: 'Hello' }] });
  assert.equal(response.status, 401);
  assert.equal(typeof response.body.error, 'string');
});

test('POST /api/chat rejects an invalid Supabase access token', async () => {
  const response = await postChat({
    token: 'test-token-invalid',
    messages: [{ role: 'user', text: 'Hello' }]
  });
  assert.equal(response.status, 401);
});

test('LIA returns the FAQ answer when the Gemini key is missing', async () => {
  const response = await postChat({
    token: 'test-token-patient',
    messages: [{ role: 'user', text: 'How do I request blood?' }]
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.fallback, true);
  assert.match(response.body.reply, /hospital reviews it first/i);
});

test('FAQ fallback refuses payment and direct donor contact', async t => {
  for (const [token, question] of [
    ['test-token-payment', 'Can I pay a donor?'],
    ['test-token-contact', 'How do I contact a donor directly?']
  ]) {
    await t.test(question, async () => {
      const response = await postChat({
        token,
        messages: [{ role: 'user', text: question }]
      });
      assert.equal(response.status, 200);
      assert.equal(response.body.fallback, true);
      assert.match(response.body.reply, /does not support/i);
      assert.match(response.body.reply, /hospital process/i);
    });
  }
});
