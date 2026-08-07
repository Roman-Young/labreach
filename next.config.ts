import type { NextConfig } from "next";

// Baseline security headers applied to every response. Deliberately excludes a full Content-Security-
// Policy: Next injects inline scripts/styles, so a correct CSP needs per-request nonces (a follow-up),
// and a wrong one silently breaks the app. These five are safe, static, and high-value — clickjacking,
// MIME-sniffing, referrer leakage, feature access, and HTTPS enforcement.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
