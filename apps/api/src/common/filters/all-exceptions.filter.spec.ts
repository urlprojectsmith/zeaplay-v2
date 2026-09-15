import {
  BadRequestException,
  Controller,
  Get,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from './all-exceptions.filter';

@Controller()
class ErrorController {
  @Get('boom')
  boom() {
    throw new BadRequestException(['name must be a string']);
  }
}

describe('AllExceptionsFilter', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ErrorController] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns standard error bodies', async () => {
    await request(app.getHttpServer())
      .get('/boom')
      .expect(400)
      .expect(({ body }) => {
        expect(body.code).toBe('VALIDATION_ERROR');
        expect(body.message).toBe('Validation failed.');
        expect(body.validation).toEqual(['name must be a string']);
      });
  });
});
