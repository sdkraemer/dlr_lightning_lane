if (process.env.DEV_MOCK_AUTH === 'true') throw new Error('Mock authentication cannot run in production.');
for(const key of ['APP_BASE_URL','AUTH0_DOMAIN','AUTH0_CLIENT_ID','AUTH0_CLIENT_SECRET','AUTH0_SECRET','AUTH0_ALLOWED_SUB'])
  if(!process.env[key]||process.env[key].includes('replace-me'))throw new Error('Missing production configuration: '+key);
if(new URL(process.env.APP_BASE_URL).protocol!=='https:')throw new Error('Production requires an HTTPS origin.');
await import('../apps/web/server.js');
