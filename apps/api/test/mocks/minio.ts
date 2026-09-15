import { Readable } from 'node:stream';

const objects = new Map<string, Buffer>();

export class Client {
  putObject(_bucket: string, key: string, body: Buffer) {
    objects.set(key, body);
    return Promise.resolve();
  }

  statObject(_bucket: string, key: string) {
    const object = objects.get(key);
    if (!object) return Promise.reject(new Error('Object not found.'));
    return Promise.resolve({ size: object.length, etag: 'test-etag', metaData: {} });
  }

  getObject(_bucket: string, key: string) {
    const object = objects.get(key);
    if (!object) return Promise.reject(new Error('Object not found.'));
    return Promise.resolve(Readable.from(object));
  }

  presignedPutObject() {
    return Promise.resolve('http://localhost:9000/zea-play-dev/upload');
  }

  presignedGetObject() {
    return Promise.resolve('http://localhost:9000/zea-play-dev/download');
  }

  bucketExists() {
    return Promise.resolve(true);
  }
}
