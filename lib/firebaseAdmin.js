import * as admin from "firebase-admin";

if (!admin.apps.length) {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const storageBucket =
    process.env.FIREBASE_STORAGE_BUCKET || (projectId ? `${projectId}.appspot.com` : undefined);

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    }),
    storageBucket,
  });
}

let dbInstance;
let bucketInstance;

export function getAdminDb() {
  if (!dbInstance) {
    dbInstance = admin.firestore();
  }
  return dbInstance;
}

export function getAdminBucket() {
  if (!bucketInstance) {
    bucketInstance = admin.storage().bucket();
  }
  return bucketInstance;
}
