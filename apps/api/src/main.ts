import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // The web app is served from a different origin (Amplify in prod, :3001 in
  // dev). WEB_ORIGIN is a comma-separated allowlist; unset reflects any
  // origin — acceptable for MVP because auth is bearer-token, not cookies.
  app.enableCors({ origin: process.env.WEB_ORIGIN?.split(',') ?? true });
  await app.listen(process.env.PORT ?? 3000);
}
await bootstrap();
