import {
  AdminAuthError,
  loadAdminSession,
  requireSessionCsrf,
} from '../adminAuthService.js';
import { AdminAuthorizationError, requirePermission } from '../authorization.js';
import {
  CatalogImageUploadError,
  MAX_CATALOG_IMAGE_BYTES,
  resolveCatalogImagePublicUrl,
  uploadCatalogProductImage,
} from './catalogImageUpload.js';
import { assertCatalogImageProductScope } from './catalogImageProductScope.js';
import { getAdminServerEnv } from '../env.js';
import {
  firstHeader,
  requireSameOrigin,
  sendJson,
  type AdminRequest,
  type AdminResponse,
} from '../http.js';
import { readAdminSessionToken } from '../session.js';
import { AdminSupabaseClient } from '../supabaseAdmin.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function readUpload(request: AdminRequest): Promise<Uint8Array> {
  const rawLength = firstHeader(request.headers['content-length']);
  if (rawLength && Number(rawLength) > MAX_CATALOG_IMAGE_BYTES) {
    throw new CatalogImageUploadError('image_size_invalid');
  }
  if (Buffer.isBuffer(request.body)) {
    if (request.body.byteLength > MAX_CATALOG_IMAGE_BYTES)
      throw new CatalogImageUploadError('image_size_invalid');
    return request.body;
  }
  if (request.body !== undefined) throw new CatalogImageUploadError('image_body_invalid');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.byteLength;
    if (length > MAX_CATALOG_IMAGE_BYTES) throw new CatalogImageUploadError('image_size_invalid');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks, length);
}

export async function handleCatalogImageRequest(
  request: AdminRequest,
  response: AdminResponse,
): Promise<void> {
  if (request.method !== 'GET' && request.method !== 'POST') {
    response.setHeader('allow', 'GET, POST');
    sendJson(response, 405, { error: 'method_not_allowed' });
    return;
  }
  if (request.method === 'POST' && !requireSameOrigin(request, response)) return;
  try {
    const token = readAdminSessionToken(firstHeader(request.headers.cookie));
    if (!token) throw new AdminAuthError('session_required', 401);
    const env = getAdminServerEnv();
    const client = new AdminSupabaseClient(env);
    const context = await loadAdminSession(token, client);
    if (request.method === 'GET') {
      const url = new URL(request.url ?? '/', 'http://admin.local');
      const shopId = url.searchParams.get('shopId') ?? '';
      if (!uuidPattern.test(shopId)) {
        sendJson(response, 400, { error: 'image_scope_invalid' });
        return;
      }
      requirePermission(context.principal, 'catalog.view', shopId);
      const imageKey = url.searchParams.get('imageKey') ?? '';
      const publicUrl = resolveCatalogImagePublicUrl({
        businessId: context.principal.businessId,
        shopId,
        imageKey,
        supabaseUrl: env.supabaseUrl,
      });
      sendJson(response, 200, { publicUrl });
      return;
    }

    requireSessionCsrf(context, firstHeader(request.headers['x-tux-admin-csrf']).trim());

    const shopId = firstHeader(request.headers['x-tux-catalog-shop-id']).trim();
    const productId = firstHeader(request.headers['x-tux-catalog-product-id']).trim();
    if (!uuidPattern.test(shopId) || !uuidPattern.test(productId)) {
      sendJson(response, 400, { error: 'image_scope_invalid' });
      return;
    }
    requirePermission(context.principal, 'catalog.edit', shopId);
    await assertCatalogImageProductScope(client, {
      businessId: context.principal.businessId,
      shopId,
      productId,
    });
    const bytes = await readUpload(request);
    const uploaded = await uploadCatalogProductImage({
      businessId: context.principal.businessId,
      shopId,
      productId,
      contentType: firstHeader(request.headers['content-type']).trim().toLowerCase(),
      bytes,
      supabaseUrl: env.supabaseUrl,
      serviceRoleKey: env.serviceRoleKey,
    });
    sendJson(response, 200, uploaded);
  } catch (error) {
    if (error instanceof AdminAuthError) {
      sendJson(response, error.status, { error: error.code });
      return;
    }
    if (error instanceof AdminAuthorizationError) {
      sendJson(response, 403, { error: 'permission_forbidden' });
      return;
    }
    if (error instanceof CatalogImageUploadError) {
      const badInput = !error.code.startsWith('image_storage_');
      sendJson(response, badInput ? 400 : 503, { error: error.code });
      return;
    }
    sendJson(response, 503, { error: 'image_upload_unavailable' });
  }
}
