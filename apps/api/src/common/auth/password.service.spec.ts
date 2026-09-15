import { PasswordService } from './password.service';

describe('PasswordService', () => {
  it('stores verifiable Argon2id hashes', () => {
    const service = new PasswordService();
    const hash = service.hash('DevelopmentPassword123!');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(service.verify(hash, 'DevelopmentPassword123!')).toBe(true);
    expect(service.verify(hash, 'wrong-password')).toBe(false);
  });

  it('treats malformed hashes as verification failures', () => {
    const service = new PasswordService();
    expect(service.verify('not-a-supported-hash', 'DevelopmentPassword123!')).toBe(false);
  });
});
