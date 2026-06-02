import { Inter, Caveat } from 'next/font/google';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });
const caveat = Caveat({ subsets: ['latin'], variable: '--font-chalk', weight: ['400', '700'] });

export const metadata = {
  title: 'Cabo — The Card Game',
  description: 'A memory-based card game. Get the lowest score to win!',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${inter.variable} ${caveat.variable}`}>
      <body>{children}</body>
    </html>
  );
}
