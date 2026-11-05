/** @type {import('next').NextConfig} */
const nextConfig = {
  // Fully client-side: `next build` writes a static site to out/ (hosted as a Render static site).
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
