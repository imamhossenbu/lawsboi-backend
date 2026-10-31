import { GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";

// Files (ticket attachments) live in a private bucket on S3-compatible storage (Backblaze B2; Cloudflare R2 or AWS
// S3 need only other S3_* values). The API uploads them and hands out short-lived signed links; nothing is public.

let client: S3Client | null = null;

function bucketClient() {
  if (!env.s3) throw new Error("File storage isn't set up: fill in S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_BUCKET.");
  client ??= new S3Client({
    region: env.s3.region,
    endpoint: env.s3.endpoint,
    forcePathStyle: true,
    credentials: { accessKeyId: env.s3.accessKeyId, secretAccessKey: env.s3.secretAccessKey },
    // B2 and R2 don't take the newer default checksum headers on every request
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
  return { s3: client, bucket: env.s3.bucket };
}

export const storageConfigured = () => env.s3 !== null;

export async function putFile(key: string, body: Buffer, contentType: string) {
  const { s3, bucket } = bucketClient();
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
}

/** A link that downloads the file under `downloadName`, valid for `seconds`. */
export async function signedFileUrl(key: string, downloadName: string, seconds = 600) {
  const { s3, bucket } = bucketClient();
  const disposition = `attachment; filename*=UTF-8''${encodeURIComponent(downloadName)}`;
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: disposition }), { expiresIn: seconds });
}

/** For the health page: the bucket answers. Returns its name. */
export async function probeBucket() {
  const { s3, bucket } = bucketClient();
  await s3.send(new HeadBucketCommand({ Bucket: bucket }));
  return bucket;
}
