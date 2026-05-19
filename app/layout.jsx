import Providers from "./providers";

export default function RootLayout({ children }) {
  console.log("[layout] rendering RootLayout");
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
