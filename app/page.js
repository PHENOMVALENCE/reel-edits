'use client';

import dynamic from 'next/dynamic';

// Video work happens entirely in the browser, so the editor never renders on the server.
const ReelMaker = dynamic(() => import('../components/ReelMaker.jsx'), {
  ssr: false,
  loading: () => <p className="busy">Loading the editor…</p>,
});

export default function Home() {
  return <ReelMaker />;
}
