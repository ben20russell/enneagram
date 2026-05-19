import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const env = (globalThis as {
  process?: { env?: Record<string, string | undefined> };
}).process?.env ?? {};

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID as string,
      clientSecret: env.GOOGLE_CLIENT_SECRET as string,
    }),
  ],
  // Optional: Add database adapter here later if you want to save users to your DB
});

export { handler as GET, handler as POST }; // App router export
// export default handler; // Pages router export
