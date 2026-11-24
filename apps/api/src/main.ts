import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import pino from 'pino';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import configuration from './config/configuration';
import { initOtel } from './config/otel';

async function bootstrap(): Promise<void> {
  const config = configuration();
  const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
  initOtel(config.otelEnabled, config.otelEndpoint);

  const app = await NestFactory.create(AppModule, { logger: ['log', 'error', 'warn', 'debug', 'verbose'] });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }));
  app.useGlobalFilters(new GlobalExceptionFilter());
  app.enableCors({ origin: config.corsOrigin.split(',').map((o) => o.trim()), credentials: true });

  const swagger = new DocumentBuilder()
    .setTitle('EsERP API')
    .setDescription('Multi-tenant SMB ERP — Phase 0 Foundation')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swagger);
  SwaggerModule.setup('api/docs', app, document);

  const port = config.port;
  await app.listen(port);
  logger.info({ port, prefix: 'api/v1' }, `EsERP API listening on :${port}`);
  new Logger('Bootstrap').log(`OpenAPI docs at http://localhost:${port}/api/docs`);
}

void bootstrap();
