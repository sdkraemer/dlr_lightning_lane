import path from 'node:path';
const root = path.resolve(import.meta.dirname,'../..');
export default {
  output:'standalone',
  outputFileTracingRoot:root,
  serverExternalPackages:['node:sqlite'],
  turbopack:{root},
  async headers() { return [
    {source:'/sw.js',headers:[{key:'Cache-Control',value:'no-cache, no-store, must-revalidate'},{key:'Service-Worker-Allowed',value:'/'}]},
    {source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'same-origin'},{key:'X-Frame-Options',value:'DENY'}]},
  ]; }
};
