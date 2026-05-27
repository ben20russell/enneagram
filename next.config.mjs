/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep native canvas binary available in Node/serverless runtime.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist"],
};

export default nextConfig;
