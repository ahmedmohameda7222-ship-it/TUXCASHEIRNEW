import { Buffer } from 'node:buffer';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const HOST = '127.0.0.1';
const PORT = 4173;
const ROOT = fileURLToPath(new URL('../apps/operations/dist/', import.meta.url));
const SHOP = '10000000-0000-4000-8000-000000000001';
const WORKER = '20000000-0000-4000-8000-000000000001';
const DEVICE = '90000000-0000-4000-8000-000000000001';
const CONVERSATION = 'a0000000-0000-4000-8000-000000000001';
const INBOUND_MESSAGE = 'b0000000-0000-4000-8000-000000000001';
const STARTED_AT = '2026-09-06T00:00:00.000Z';
const STARTER_TEMPLATE_ID = 'starter-order-follow-up';
const STARTER_TEMPLATE_TEXT = 'Following up on your TUX order.';
const POLICIES = new Set(['FREE_FORM', 'TEMPLATE_ONLY', 'BLOCKED']);

const conversation = {
  id: CONVERSATION,
  shopId: SHOP,
  normalizedPhone: '+201001234567',
  displayPhone: '01001234567',
  customerName: 'E2E Customer',
  context: 'DIRECT',
  linkedOrderId: null,
  unreadCount: 1,
  archived: false,
  followUp: false,
  lastMessageAt: STARTED_AT,
};

function initialMessages() {
  return [
    {
      id: INBOUND_MESSAGE,
      shopId: SHOP,
      conversationId: CONVERSATION,
      providerMessageId: null,
      outboundIntentKey: null,
      direction: 'INBOUND',
      kind: 'TEXT',
      text: 'Can I order?',
      mediaRef: null,
      media: null,
      location: null,
      status: 'DELIVERED',
      sentByWorkerId: null,
      initiatedByDeviceId: null,
      initiatedAt: null,
      createdAt: STARTED_AT,
    },
  ];
}

let policy = 'FREE_FORM';
let messages = initialMessages();
const sentByIntent = new Map();
const counters = { sendMessage: 0, sendTemplate: 0 };

function resetScenario(nextPolicy) {
  policy = nextPolicy;
  messages = initialMessages();
  sentByIntent.clear();
  counters.sendMessage = 0;
  counters.sendTemplate = 0;
}

function writeJson(response, status, body) {
  const bytes = JSON.stringify(body);
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json',
    'content-length': String(Buffer.byteLength(bytes)),
  });
  response.end(bytes);
}

async function readJson(request) {
  let body = '';
  for await (const chunk of request) body += chunk;
  return JSON.parse(body || '{}');
}

function snapshot() {
  return {
    conversations: [conversation],
    messages,
    quickReplies: [],
    orderLinks: [],
    nextCursor: null,
  };
}

function config() {
  return {
    storefrontUrl: 'https://menu.tux.example',
    storeLocation: null,
  };
}

function target() {
  if (policy === 'TEMPLATE_ONLY') {
    return {
      mode: 'TEMPLATE_ONLY',
      conversationId: CONVERSATION,
      normalizedPhone: conversation.normalizedPhone,
      displayPhone: conversation.displayPhone,
      templates: [
        {
          id: STARTER_TEMPLATE_ID,
          label: 'Order follow-up',
          languageCode: 'en',
          previewText: STARTER_TEMPLATE_TEXT,
        },
      ],
      config: config(),
    };
  }
  if (policy === 'BLOCKED') {
    return {
      mode: 'BLOCKED',
      conversationId: CONVERSATION,
      reason: 'NO_APPROVED_TEMPLATE',
      config: config(),
    };
  }
  return {
    mode: 'FREE_FORM',
    conversationId: CONVERSATION,
    freeFormUntil: '2099-01-01T00:00:00.000Z',
    config: config(),
  };
}

function sentMessage(body, text) {
  const index = sentByIntent.size + 1;
  return {
    id: `c0000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    shopId: SHOP,
    conversationId: CONVERSATION,
    providerMessageId: null,
    outboundIntentKey: body.outboundIntentKey,
    direction: 'OUTBOUND',
    kind: 'TEXT',
    text,
    mediaRef: null,
    media: null,
    location: null,
    status: 'SENT',
    sentByWorkerId: WORKER,
    initiatedByDeviceId: DEVICE,
    initiatedAt: STARTED_AT,
    createdAt: STARTED_AT,
  };
}

async function handleControl(request, response, url) {
  if (request.method !== 'POST' || url.pathname !== '/__tux_whatsapp_control__') return false;
  const body = await readJson(request);
  if (!POLICIES.has(body.policy)) {
    writeJson(response, 400, { error: 'invalid_whatsapp_e2e_policy' });
    return true;
  }
  resetScenario(body.policy);
  writeJson(response, 200, { ok: true, policy });
  return true;
}

async function handleApi(request, response, url) {
  if (request.method === 'GET' && url.pathname === '/api/whatsapp') {
    writeJson(response, 200, snapshot());
    return true;
  }
  if (request.method === 'GET' && url.pathname === '/__tux_whatsapp_assertions__') {
    writeJson(response, 200, counters);
    return true;
  }
  if (request.method !== 'POST' || url.pathname !== '/api/whatsapp') return false;

  const body = await readJson(request);
  if (body.action === 'RESOLVE_TARGET') {
    writeJson(response, 200, { target: target() });
    return true;
  }
  if (body.action === 'SEND_MESSAGE') {
    const intentKey = `message:${body.outboundIntentKey}`;
    let message = sentByIntent.get(intentKey);
    if (message === undefined) {
      message = sentMessage(body, body.text);
      sentByIntent.set(intentKey, message);
      messages.push(message);
      counters.sendMessage += 1;
    }
    writeJson(response, 200, { message });
    return true;
  }
  if (body.action === 'SEND_TEMPLATE') {
    if (policy !== 'TEMPLATE_ONLY' || body.templateId !== STARTER_TEMPLATE_ID) {
      writeJson(response, 400, { error: 'invalid_whatsapp_e2e_template' });
      return true;
    }
    const intentKey = `template:${body.outboundIntentKey}`;
    let message = sentByIntent.get(intentKey);
    if (message === undefined) {
      message = sentMessage(body, STARTER_TEMPLATE_TEXT);
      sentByIntent.set(intentKey, message);
      messages.push(message);
      counters.sendTemplate += 1;
    }
    writeJson(response, 200, { message });
    return true;
  }
  writeJson(response, 400, { error: 'unsupported_whatsapp_e2e_action' });
  return true;
}

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

async function serveStatic(response, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const normalized = normalize(relative);
  if (normalized.startsWith('..')) {
    response.writeHead(404).end();
    return;
  }
  let filePath = join(ROOT, normalized);
  try {
    const bytes = await readFile(filePath);
    response.writeHead(200, {
      'content-type': contentTypes[extname(filePath)] ?? 'application/octet-stream',
    });
    response.end(bytes);
  } catch {
    filePath = join(ROOT, 'index.html');
    const bytes = await readFile(filePath);
    response.writeHead(200, { 'content-type': contentTypes['.html'] });
    response.end(bytes);
  }
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${HOST}:${PORT}`);
  try {
    if (await handleControl(request, response, url)) return;
    if (await handleApi(request, response, url)) return;
    await serveStatic(response, url.pathname);
  } catch {
    writeJson(response, 500, { error: 'whatsapp_e2e_server_error' });
  }
}).listen(PORT, HOST);
