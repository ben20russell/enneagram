import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { FirebaseAdapter } from "@next-auth/firebase-adapter";
import { adminDb } from "../../../../lib/firebaseAdmin";

const env = process.env;

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  adapter: FirebaseAdapter(adminDb),
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
