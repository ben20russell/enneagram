import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const env = process.env;

export const authOptions = {
  secret: env.NEXTAUTH_SECRET,
  trustHost: true,
  session: {
    strategy: "jwt",
  },
  providers: [
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      console.log("[auth] signIn callback", {
        provider: account?.provider,
        hasEmail: !!user?.email,
        profileEmail: profile?.email,
      });
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) {
        token.email = user.email;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token?.email) {
        session.user.email = token.email;
      }
      return session;
    },
  },
  logger: {
    error(code, metadata) {
      console.log("[auth] NextAuth error", code, metadata);
    },
    warn(code) {
      console.log("[auth] NextAuth warning", code);
    },
    debug(code, metadata) {
      console.log("[auth] NextAuth debug", code, metadata);
    },
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
