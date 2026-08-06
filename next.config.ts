import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname),
  serverExternalPackages: ["better-sqlite3"],
  // Route handlers here read and write generated sites on disk, so the tracer
  // cannot follow them and copies the whole project into the standalone build
  // unless it is told what is unreachable at runtime.
  outputFileTracingExcludes: {
    "**": ["./tests/**", "./sites/**", "./src/**", "./*.md", "./mainstreet.db*"],
  },
  devIndicators: false,
};

export default nextConfig;
