export async function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const [, attributes, source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (/\bsrc\s*=/i.test(attributes) || !source.trim()) continue;
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
    hashes.add("'sha256-" + btoa(String.fromCharCode(...new Uint8Array(digest))) + "'");
  }
  return [...hashes];
}

export function securityHeaders(hashes = []) {
  return {
    "Content-Security-Policy": [
      "default-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'none'",
      "script-src 'self' https://static.cloudflareinsights.com " + hashes.join(" "),
      "script-src-attr 'none'", "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:", "img-src 'self' https: data:",
      "connect-src 'self' https://cloudflareinsights.com", "frame-src https://www.youtube-nocookie.com",
      "form-action 'self'", "upgrade-insecure-requests",
    ].join("; "),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Strict-Transport-Security": "max-age=31536000",
  };
}

export async function secureResponse(upstream) {
  const hashes = upstream.headers.get("Content-Type")?.includes("text/html") && upstream.body
    ? await inlineScriptHashes(await upstream.clone().text()) : [];
  const response = new Response(upstream.body, upstream);
  for (const [name, value] of Object.entries(securityHeaders(hashes))) response.headers.set(name, value);
  return response;
}
