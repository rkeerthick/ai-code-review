import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from './providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: { default: 'AI Code Review', template: '%s | AI Code Review' },
  description: 'Production-grade AI-powered code review for engineering teams. Automated PR reviews with deep insights on security, bugs, performance, and code quality.',
  keywords: ['code review', 'AI', 'pull request', 'security', 'software quality'],
  authors: [{ name: 'AI Code Review' }],
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: 'AI Code Review',
    title: 'AI Code Review — Smarter PRs, Better Code',
    description: 'Automated AI code reviews for GitHub pull requests',
  },
};

export const viewport: Viewport = {
  themeColor: [{ media: '(prefers-color-scheme: light)', color: '#ffffff' }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
