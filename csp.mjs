/** Live nginx currently uses frame-src 'self' blob:, which blocks SignNow. Keep these in sync. */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self' data: https://fonts.gstatic.com",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "img-src 'self' data: https: blob:",
  "object-src 'self' blob:",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "upgrade-insecure-requests",
  "worker-src 'self' blob: https://unpkg.com",
  "connect-src 'self' blob: wss: https://res.cloudinary.com https://*.cloudinary.com https://app.signnow.com https://api.signnow.com https://signnow.com https://unpkg.com",
  "frame-src 'self' blob: data: https://app.signnow.com https://www.signnow.com https://signnow.com https://*.signnow.com",
].join(";");
