import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The registry jsonStore reads data/registry.json at runtime via fs. Next's
  // serverless file tracing doesn't detect dynamic fs reads, so include the file
  // explicitly for the routes that load the catalog (dev/demo store; prod uses KV).
  outputFileTracingIncludes: {
    "/catalog": ["./data/**"],
    "/miniapp/[id]": ["./data/**"],
    "/api/**": ["./data/**"],
  },
};

export default nextConfig;
