import test from 'node:test';
import assert from 'node:assert/strict';
import { probeTunnel, describeTunnelFailure, createTunnelProbe } from '../dist/library.mjs';

const firstOrigin = 'https://first-probe.trycloudflare.com';
const secondOrigin = 'https://second-probe.trycloudflare.com';
function dnsAnswer(url, { status = 0, family, wrongQuestion = false, truncated = false } = {}) {
  const name = url.searchParams.get('name') + '.', type = Number(url.searchParams.get('type'));
  return Response.json({ Status: status, TC: truncated,
    Question: [{ name: wrongQuestion ? 'unrelated.example.' : name, type }],
    Answer: status === 0 && (!family || family === type) ? [{ name, type,
      data: type === 1 ? '104.16.230.132' : '2606:4700::6810:e684' }] : [],
  });
}

test('a fresh hostname never reaches the OS health lookup before DNS publication', async () => {
  let published = false, healthCalls = 0;
  const queryTypes = [];
  const probe = createTunnelProbe(async (input, options) => {
    const url = new URL(input);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    if (url.hostname === 'cloudflare-dns.com') {
      assert.equal(options.headers.Accept, 'application/dns-json');
      assert.equal(url.searchParams.get('name'), new URL(firstOrigin).hostname);
      queryTypes.push(url.searchParams.get('type'));
      return dnsAnswer(url, { status: published ? 0 : 3 });
    }
    healthCalls++;
    assert.equal(published, true);
    return Response.json({ runtimeId: 'expected' });
  });
  await assert.rejects(probe(firstOrigin, 'expected'), /published in DNS/);
  assert.equal(healthCalls, 0);
  published = true;
  await probe(firstOrigin, 'expected');
  assert.equal(healthCalls, 1);
  assert.deepEqual(queryTypes, ['1', '28', '1', '28']);
});

test('publication is remembered through HTTP startup retries and checked again on replacement', async () => {
  const queries = [], origins = [];
  const probe = createTunnelProbe(async input => {
    const url = new URL(input);
    if (url.hostname === 'cloudflare-dns.com') { queries.push(url.searchParams.get('name')); return dnsAnswer(url); }
    origins.push(url.origin);
    return origins.length === 1 ? new Response('temporary', { status: 530 }) : Response.json({ runtimeId: 'expected' });
  });
  await assert.rejects(probe(firstOrigin, 'expected'), /HTTP 530/);
  await probe(firstOrigin, 'expected');
  assert.equal(queries.length, 2);
  await probe(secondOrigin, 'expected');
  assert.deepEqual(queries, [new URL(firstOrigin).hostname, new URL(firstOrigin).hostname,
    new URL(secondOrigin).hostname, new URL(secondOrigin).hostname]);
  assert.deepEqual(origins, [firstOrigin, firstOrigin, secondOrigin]);
});

test('publication supports IPv4-only and IPv6-only DNS without overriding HTTPS resolution', async () => {
  for (const family of [1, 28]) {
    const probe = createTunnelProbe(async (input, options) => {
      const url = new URL(input);
      if (url.hostname === 'cloudflare-dns.com') return dnsAnswer(url, { family });
      assert.equal(String(input), `${firstOrigin}/health`);
      assert.equal(options.dispatcher, undefined);
      assert.equal(options.headers, undefined);
      return Response.json({ runtimeId: 'expected' });
    });
    await probe(firstOrigin, 'expected');
  }
});

test('one published address family is sufficient when the other query still caches NXDOMAIN', async () => {
  for (const family of [1, 28]) {
    let healthCalls = 0;
    const probe = createTunnelProbe(async input => {
      const url = new URL(input);
      if (url.hostname === 'cloudflare-dns.com') {
        return dnsAnswer(url, { status: Number(url.searchParams.get('type')) === family ? 0 : 3 });
      }
      healthCalls++;
      return Response.json({ runtimeId: 'expected' });
    });
    await probe(firstOrigin, 'expected');
    assert.equal(healthCalls, 1);
  }
});

test('unavailable or invalid publication replies cannot unlock the system health lookup', async () => {
  for (const reply of [
    () => { throw new Error('private transport details'); },
    () => new Response('private response', { status: 503 }),
    () => new Response('private invalid JSON'),
    url => dnsAnswer(url, { wrongQuestion: true }),
    url => dnsAnswer(url, { truncated: true }),
    url => dnsAnswer(url, { status: 2 }),
    url => dnsAnswer(url, { family: 5 }),
  ]) {
    let healthCalls = 0;
    const probe = createTunnelProbe(async input => {
      const url = new URL(input);
      if (url.hostname === 'cloudflare-dns.com') return reply(url);
      healthCalls++;
      return Response.json({ runtimeId: 'expected' });
    });
    await assert.rejects(probe(firstOrigin, 'expected'), error => {
      assert.ok(!describeTunnelFailure(error).includes('private'));
      return true;
    });
    assert.equal(healthCalls, 0);
  }
  let calls = 0;
  const probe = createTunnelProbe(async () => { calls++; });
  await assert.rejects(probe('https://unrelated.example', 'expected'), /invalid public origin/);
  assert.equal(calls, 0);
});

test('health probes require the expected runtime and report safe HTTP/JSON failures', async () => {
  const run = response => probeTunnel('https://probe.trycloudflare.com', 'expected', async (_url, options) => {
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    return response;
  });
  await run(Response.json({ runtimeId: 'expected' }));
  for (const [response, message] of [
    [new Response('private response body', { status: 530 }), 'Public tunnel health check returned HTTP 530.'],
    [new Response('private response body'), 'Public tunnel health check returned invalid JSON.'],
    [Response.json({ runtimeId: 'other' }), 'Public tunnel health check reached a different runtime.'],
  ]) {
    await assert.rejects(run(response), error => {
      assert.equal(describeTunnelFailure(error), message);
      return true;
    });
  }
});

test('DNS, TLS and timeout diagnostics never include arbitrary exception messages', () => {
  for (const code of ['ENOTFOUND', 'EAI_AGAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ECONNREFUSED']) {
    const error = new TypeError('private header value', { cause: { code, message: 'private URL' } });
    assert.ok(describeTunnelFailure(error).includes(code));
    assert.ok(!describeTunnelFailure(error).includes('private'));
  }
  assert.match(describeTunnelFailure(new DOMException('secret', 'TimeoutError')), /timed out/);
  assert.ok(!describeTunnelFailure(new Error('secret')).includes('secret'));
});
