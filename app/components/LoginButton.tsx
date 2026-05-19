"use client";

import { signIn, signOut, useSession } from "next-auth/react";

export default function LoginButton() {
  const { data: session } = useSession();
  console.log("[auth] session state", session ? "authenticated" : "anonymous");

  if (session) {
    return (
      <div data-testid="auth-session">
        <p>Welcome, {session.user?.name}</p>
        <button data-testid="sign-out" onClick={() => signOut()}>
          Sign out
        </button>
      </div>
    );
  }

  return (
    <button data-testid="sign-in-google" onClick={() => signIn("google")}>
      Sign in with Google
    </button>
  );
}
