import type { ReactNode } from "react";
import LoginButton from "./components/LoginButton";
import Providers from "./providers";

type RootLayoutProps = {
  children: ReactNode;
};

export default function RootLayout({ children }: RootLayoutProps) {
  console.log("[layout] rendering RootLayout");
  return (
    <html lang="en">
      <body>
        <Providers>
          <div
            data-testid="auth-top-right"
            style={{
              position: "fixed",
              top: "14px",
              right: "14px",
              zIndex: 1200,
            }}
          >
            <LoginButton />
          </div>
          {children}
        </Providers>
      </body>
    </html>
  );
}
