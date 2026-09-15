import { Injectable } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as crypto from 'node:crypto';

const memory = 19_456;
const passes = 2;
const parallelism = 1;
const tagLength = 32;
const version = 19;

@Injectable()
export class PasswordService {
  hash(password: string) {
    const nonce = randomBytes(16);
    const tag = runArgon2id(password, nonce);
    return `$argon2id$v=${version}$m=${memory},t=${passes},p=${parallelism}$${nonce.toString(
      'base64url',
    )}$${tag.toString('base64url')}`;
  }

  verify(storedHash: string, password: string) {
    try {
      const parsed = parseHash(storedHash);
      const candidate = runArgon2id(password, parsed.nonce);
      return candidate.length === parsed.tag.length && timingSafeEqual(candidate, parsed.tag);
    } catch {
      return false;
    }
  }
}

function runArgon2id(password: string, nonce: Buffer) {
  const { argon2Sync } = crypto as typeof crypto & {
    argon2Sync: (algorithm: 'argon2id', options: Argon2Options) => Buffer;
  };
  return argon2Sync('argon2id', {
    message: Buffer.from(password),
    nonce,
    parallelism,
    tagLength,
    memory,
    passes,
  });
}

function parseHash(storedHash: string) {
  const parts = storedHash.split('$');
  if (
    parts.length !== 6 ||
    parts[1] !== 'argon2id' ||
    parts[2] !== `v=${version}` ||
    parts[3] !== `m=${memory},t=${passes},p=${parallelism}`
  ) {
    throw new Error('Unsupported password hash.');
  }
  return {
    nonce: Buffer.from(parts[4] ?? '', 'base64url'),
    tag: Buffer.from(parts[5] ?? '', 'base64url'),
  };
}

interface Argon2Options {
  message: Buffer;
  nonce: Buffer;
  parallelism: number;
  tagLength: number;
  memory: number;
  passes: number;
}
