import { isIP } from 'node:net'
import { z } from 'zod'

class ProbeFailure extends Error {}

const dnsReply = z.object({
  Status: z.number().int().min(0).max(15),
  TC: z.boolean().optional(),
  Question: z.array(z.object({ name: z.string(), type: z.number().int() })).length(1),
  Answer: z.array(z.object({ name: z.string(), type: z.number().int(), data: z.string() })).optional(),
})

// A Quick Tunnel URL may be emitted before its DNS records exist. Looking it up
// through the OS at that point can leave the OS/router caching NXDOMAIN for
// much longer than startup. Check publication over HTTPS first, then still
// require the ordinary system-resolved HTTPS health check used by clients.
// The DNS answers are never used to override connection addresses or TLS.
export function createTunnelProbe(request: typeof fetch = fetch) {
  let publishedOrigin: string | undefined
  return async (origin: string, runtimeId: string) => {
    if (!/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com$/.test(origin)) {
      throw new ProbeFailure('The tunnel supplied an invalid public origin.')
    }
    if (origin !== publishedOrigin) {
      const hostname = new URL(origin).hostname
      const answers = await Promise.allSettled([1, 28].map(async type => {
        const url = new URL('https://cloudflare-dns.com/dns-query')
        url.searchParams.set('name', hostname); url.searchParams.set('type', String(type))
        let response: Response
        try {
          response = await request(url, { headers: { Accept: 'application/dns-json' },
            signal: AbortSignal.timeout(3000), redirect: 'error' })
        } catch { throw new ProbeFailure('The tunnel DNS publication service is unreachable.') }
        if (response.status !== 200) {
          await response.body?.cancel()
          throw new ProbeFailure(`The tunnel DNS publication check returned HTTP ${response.status}.`)
        }
        const parsed = dnsReply.safeParse(await response.json().catch(() => null))
        if (!parsed.success || parsed.data.TC || parsed.data.Question[0].type !== type
          || parsed.data.Question[0].name.toLowerCase().replace(/\.$/, '') !== hostname) {
          throw new ProbeFailure('The tunnel DNS publication check returned an invalid response.')
        }
        const reply = parsed.data
        if (reply.Status !== 0) throw new ProbeFailure('Waiting for the new tunnel hostname to be published in DNS.')
        return reply.Answer?.some(answer => answer.type === type
          && answer.name.toLowerCase().replace(/\.$/, '') === hostname
          && isIP(answer.data) === (type === 1 ? 4 : 6)) ?? false
      }))
      // Either address family proves the name exists. The other query can
      // still hold an older negative response in a recursive resolver's cache.
      // Actual IPv4/IPv6 reachability is checked through normal HTTPS below.
      if (!answers.some(answer => answer.status === 'fulfilled' && answer.value)) {
        const failure = answers.find(answer => answer.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
        throw new ProbeFailure('Waiting for the new tunnel hostname to be published in DNS.')
      }
      publishedOrigin = origin
    }
    await probeTunnel(origin, runtimeId, request)
  }
}

// Only fixed descriptions and HTTP status numbers may reach diagnostics.
// Never forward request headers, response bodies or raw exception messages.
export function describeTunnelFailure(error: unknown): string {
  if (error instanceof ProbeFailure) return error.message
  const failure = error as { code?: string; name?: string; cause?: { code?: string } } | undefined
  const code = failure?.cause?.code ?? failure?.code
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return `Public tunnel DNS lookup failed (${code}).`
  if (['CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(code ?? '')) {
    return `Public tunnel TLS certificate verification failed (${code}).`
  }
  if (failure?.name === 'TimeoutError' || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code ?? '')) {
    return 'Public tunnel health check timed out.'
  }
  if (code === 'ECONNREFUSED' || code === 'ECONNRESET') return `Public tunnel connection failed (${code}).`
  return 'The tunnel process stopped or its public HTTPS health check failed.'
}

export async function probeTunnel(origin: string, runtimeId: string, request: typeof fetch = fetch) {
  const response = await request(`${origin}/health`, { signal: AbortSignal.timeout(3000), redirect: 'error' })
  if (response.status !== 200) {
    await response.body?.cancel()
    throw new ProbeFailure(`Public tunnel health check returned HTTP ${response.status}.`)
  }
  let body: { runtimeId?: unknown } | null
  try { body = await response.json() as typeof body }
  catch { throw new ProbeFailure('Public tunnel health check returned invalid JSON.') }
  if (body?.runtimeId !== runtimeId) throw new ProbeFailure('Public tunnel health check reached a different runtime.')
}
