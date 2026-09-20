const crypto = require('crypto');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// Bucket and region have defaults rather than being required. Neither is a secret -
// the bucket name appears in every presigned URL the API hands out - and defaulting
// them means the task definition does not need a new revision to add two values that
// never change. DB_PASSWORD is the opposite case and has no default at all.
const BUCKET = process.env.S3_BUCKET || 'notes-api-zaman-uploads';
const REGION = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

// No credentials are passed. Inside a Fargate task the SDK reads them from the
// container credentials endpoint, which serves the task role - notes-api-task-role-zaman,
// scoped to s3:GetObject and s3:PutObject on this bucket's objects and nothing else.
// The execution role is a different principal and the application never sees it.
const s3 = new S3Client({ region: REGION });

const UPLOAD_EXPIRY_SECONDS = 300;
const DOWNLOAD_EXPIRY_SECONDS = 60;

// A filename arrives from the client, so it decides part of an S3 key. Anything that
// could climb out of the tenant's prefix has to go: path separators and dot segments
// above all. Without this, a filename of '../../globex/private/x' would place an
// object outside the prefix every later check relies on.
function safeFilename(name) {
  return String(name)
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 100) || 'file';
}

function privatePrefix(tenantSlug) {
  return `tenants/${tenantSlug}/private/`;
}

function buildKey(tenantSlug, filename, visibility) {
  const unique = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  const safe = safeFilename(filename);
  return visibility === 'public'
    ? `public/${tenantSlug}/${unique}-${safe}`
    : `${privatePrefix(tenantSlug)}${unique}-${safe}`;
}

// The isolation check, and the only thing standing between two tenants.
//
// The trailing slash matters: comparing against 'tenants/acme' alone would also accept
// 'tenants/acme-corp/private/x', a different tenant whose name happens to start the
// same way.
function ownsKey(tenantSlug, key) {
  return typeof key === 'string' && key.startsWith(privatePrefix(tenantSlug));
}

async function presignUpload(key, contentType) {
  const cmd = new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    ContentType: contentType || 'application/octet-stream',
  });
  return getSignedUrl(s3, cmd, { expiresIn: UPLOAD_EXPIRY_SECONDS });
}

async function presignDownload(key) {
  const cmd = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: DOWNLOAD_EXPIRY_SECONDS });
}

module.exports = {
  BUCKET,
  REGION,
  UPLOAD_EXPIRY_SECONDS,
  DOWNLOAD_EXPIRY_SECONDS,
  buildKey,
  ownsKey,
  presignUpload,
  presignDownload,
};
