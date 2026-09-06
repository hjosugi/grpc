import { resolve } from 'node:path';
import { Transport, type GrpcOptions } from '@nestjs/microservices';

export const protoPath = resolve(process.env.PROTO_PATH ?? '../proto/shop/v1/shop.proto');
export const fixturesPath = resolve(process.env.FIXTURES_PATH ?? '../fixtures/orders.json');
export const loader = { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true };

export function grpcOptions(url = process.env.GRPC_ADDR ?? '127.0.0.1:50053'): GrpcOptions {
  return { transport: Transport.GRPC, options: {
    package: 'shop.v1', protoPath, url, loader,
    maxReceiveMessageLength: 1024 * 1024,
  }};
}
