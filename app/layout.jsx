import "./globals.css";
import Providers from "./providers";

export const metadata = {
  title: "Enneagram Dashboard",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
    apple: "/favicon.svg",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }) {
  console.log("[layout] rendering RootLayout");
  return (
    <html lang="en">
      <body suppressHydrationWarning>
        <Providers>
          {children}
        </Providers>
        {/* Inject AUTH_BASE_URL into the client for public/report.js to read. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `if (typeof window !== 'undefined') { window.__AUTH_BASE_URL__ = "${process.env.NEXT_PUBLIC_AUTH_BASE_URL || ''}"; }`,
          }}
        />
      </body>
    </html>
  );
}
