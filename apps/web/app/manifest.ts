import type { MetadataRoute } from 'next';
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'My Lightning Lanes',
    short_name: 'Lightning Lanes',
    description: 'Personal Disneyland return-time alerts',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f7f9',
    theme_color: '#ffffff',
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
    ],
  };
}
