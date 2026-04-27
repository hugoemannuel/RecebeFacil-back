import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  // Segurança Básica
  app.use(helmet());
  
  // CORS para permitir comunicação com o frontend
  app.enableCors({
    origin: ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
  });

  // Validação Global de DTOs
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true, // Remove propriedades que não estão no DTO
    forbidNonWhitelisted: true, // Retorna erro se enviar propriedade não mapeada
    transform: true, // Transforma os payloads nos tipos especificados
  }));

  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
