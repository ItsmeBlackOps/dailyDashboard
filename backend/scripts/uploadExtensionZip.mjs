// Uploads the packaged browser-extension zip to the Supabase storage bucket so
// experts can download it from a stable URL. Run after `bash
// browser-extension/package.sh`:
//   node backend/scripts/uploadExtensionZip.mjs
// Uploads both the versioned file and a stable `...-latest.zip`, prints URLs.
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

// config/index.js reads process.env at import time, so load the repo-root .env
// FIRST, then import config dynamically.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
const { config } = await import('../src/config/index.js');

const sc = config.storage || {};
if (!sc.bucket || !sc.endpoint || !sc.accessKeyId || !sc.secretAccessKey) {
  console.error('Storage not configured (need SUPABASE_S3_* env).');
  process.exit(1);
}

const distDir = new URL('../../browser-extension/dist/', import.meta.url);
const zips = fs.readdirSync(distDir).filter((f) => /^interview-meeting-detector-v.*\.zip$/.test(f));
if (zips.length === 0) {
  console.error('No zip in browser-extension/dist/. Run: bash browser-extension/package.sh');
  process.exit(1);
}
zips.sort();
const filename = zips[zips.length - 1];
const body = fs.readFileSync(new URL(filename, distDir));

const client = new S3Client({
  region: sc.region || 'us-east-1',
  endpoint: sc.endpoint,
  credentials: { accessKeyId: sc.accessKeyId, secretAccessKey: sc.secretAccessKey },
  forcePathStyle: true,
});

const keys = [`extensions/${filename}`, 'extensions/interview-meeting-detector-latest.zip'];
for (const Key of keys) {
  await client.send(new PutObjectCommand({
    Bucket: sc.bucket,
    Key,
    Body: body,
    ContentType: 'application/zip',
    CacheControl: 'no-cache',
  }));
  console.log('uploaded:', `${sc.publicUrl}/${sc.bucket}/${Key}`);
}
process.exit(0);
