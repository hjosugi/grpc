import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { grpcOptions } from './config.js';

const app = await NestFactory.createMicroservice(AppModule, grpcOptions());
app.enableShutdownHooks();
await app.listen();
