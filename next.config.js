/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
}

module.exports = {
  distDir: 'build',
  nextConfig,
  nextConfigFile: 'next.config.js',
  webpack: (config, { isServer }) => {
    // Modify the webpack configuration
    if (!isServer) {
      config.node = {
        fs: 'empty',
      };
    }

    return nextConfig;
  },
};
