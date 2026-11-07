import './globals.css';

export const metadata = {
  title: 'Reel Edits',
  description: 'Turn short clips and photos into polished vertical reels, right on your phone.',
  appleWebApp: { capable: true, title: 'Reel Edits', statusBarStyle: 'black-translucent' },
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#0e0d12',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
