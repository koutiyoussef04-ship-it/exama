/**
 * A tiny local stand-in for the Anthropic Messages API (POST /v1/messages).
 * Lets tests exercise the real AnthropicProvider/SDK code path — request shape,
 * error mapping, retries — without a real API key or network access.
 */
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FakeRequest = { headers: IncomingMessage['headers']; body: any };
export type FakeReply =
  | { text: string; stopReason?: string; delayMs?: number }
  | { status: number; errorType: string; message?: string };

export async function startFakeAnthropic(handler: (req: FakeRequest) => FakeReply | Promise<FakeReply>) {
  const requests: FakeRequest[] = [];
  const server = createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const request = { headers: req.headers, body: raw ? JSON.parse(raw) : null };
    requests.push(request);
    const reply = await handler(request);
    if ('status' in reply) {
      res.writeHead(reply.status, { 'content-type': 'application/json', 'retry-after': '0' });
      res.end(JSON.stringify({ type: 'error', error: { type: reply.errorType, message: reply.message ?? reply.errorType } }));
      return;
    }
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    if (res.destroyed) return;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'msg_fake',
        type: 'message',
        role: 'assistant',
        model: request.body?.model,
        content: [{ type: 'text', text: reply.text }],
        stop_reason: reply.stopReason ?? 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

/** The user-message text of a recorded request. */
export const promptOf = (r: FakeRequest): string => r.body.messages[0].content;
