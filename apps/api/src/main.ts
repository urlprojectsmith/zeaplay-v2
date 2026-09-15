import compression from 'compression';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { HttpStatus, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { validateEnvironment, parseCorsOrigins } from '@zea-play/config';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const env = validateEnvironment(process.env);
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();
  app.use(helmet());
  app.use(compression());
  app.use(json({ limit: env.REQUEST_BODY_LIMIT }));
  app.use(urlencoded({ extended: false, limit: env.REQUEST_BODY_LIMIT }));
  app.enableCors({ origin: parseCorsOrigins(env.CORS_ORIGINS), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      errorHttpStatusCode: HttpStatus.UNPROCESSABLE_ENTITY,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());

  const documentConfig = new DocumentBuilder()
    .setTitle('Zea Play API')
    .setDescription('Phase 4 multi-tenant API foundation')
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-agency-id' }, 'agency')
    .addApiKey({ type: 'apiKey', in: 'header', name: 'x-workspace-id' }, 'workspace')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, documentConfig), {
    useGlobalPrefix: true,
  });

  await app.listen(env.API_PORT);
}

void bootstrap();
