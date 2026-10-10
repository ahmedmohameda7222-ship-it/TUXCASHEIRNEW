// Vercel must trace these TypeScript sources as compiled .js modules; raw .ts specifiers are not copied into the Lambda filesystem.
// Keep this boundary on .js specifiers unless the deployed Lambda packaging contract is changed and re-verified.
export { parseEntityId } from '../packages/domain/src/ids.js';
export { normalizeEgyptianPhone } from '../packages/domain/src/phone.js';
export { instant } from '../packages/domain/src/time.js';
export { assertWhatsAppMessageInvariant } from '../packages/domain/src/whatsapp.js';
export { parseWhatsAppMessage } from '../packages/application/src/whatsappWire.js';
