import { NestFactory } from '@nestjs/core';
import { validateEnvironment } from '@zea-play/config';
import { WorkerModule } from './worker.module';

async function bootstrap() {
  const env = validateEnvironment(process.env);
  const app = await NestFactory.create(WorkerModule, { bufferLogs: true });
  await app.listen(env.WORKER_PORT);
}

void bootstrap();
