import crypto from 'node:crypto';

const N = 16384;

function scrypt(pw: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(pw, salt, 32, { N }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/** 비밀번호는 scrypt 해시로만 보관한다. */
export async function hashPassword(pw: string) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(pw: string, hash: string) {
  const [alg, salt, key] = hash.split('$');
  if (alg !== 'scrypt' || !salt || !key) return false;
  const want = Buffer.from(key, 'base64url');
  const got = await scrypt(pw, Buffer.from(salt, 'base64url'));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

export function safeEqual(a: string, b: string) {
  const x = crypto.createHash('sha256').update(a).digest();
  const y = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x, y);
}
