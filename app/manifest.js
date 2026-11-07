export default function manifest() {
  return {
    name: 'Reel Edits',
    short_name: 'Reels',
    description: 'Turn short clips and photos into polished vertical reels.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0e0d12',
    theme_color: '#0e0d12',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
