import type { NextConfig } from "next";

const devOrigins = ['127.0.0.1', 'localhost', '[::1]'];
for (const value of [process.env.APP_ORIGIN, ...(process.env.ALLOWED_ORIGINS ?? '').split(',')]) {
  if (value?.trim()) {
    try { devOrigins.push(new URL(value.trim()).hostname); } catch { /* Env validation reports this at startup. */ }
  }
}
if (process.env.ALLOWED_DEV_ORIGINS) {
  devOrigins.push(...process.env.ALLOWED_DEV_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean));
}

const nextConfig: NextConfig = {
  devIndicators: false,
  allowedDevOrigins: [...new Set(devOrigins)],
  serverExternalPackages: ["better-auth", "@better-auth/oauth-provider"],
  outputFileTracingIncludes: {
    "/*": ["./src/storage/schema.sql", "./src/storage/agent-schema.sql"],
  },
};

export default nextConfig;
