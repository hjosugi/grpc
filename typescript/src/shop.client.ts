import { Injectable, Inject, Module, type OnModuleInit } from '@nestjs/common';
import { ClientsModule, type ClientGrpc, type ClientProxy } from '@nestjs/microservices';
import { Metadata, type CallOptions } from '@grpc/grpc-js';
import { type Observable } from 'rxjs';
import { grpcOptions } from './config.js';
import type { GetOrderRequest } from './generated/shop/v1/GetOrderRequest.js';
import type { GetPaymentRequest } from './generated/shop/v1/GetPaymentRequest.js';
import type { ListOrdersRequest } from './generated/shop/v1/ListOrdersRequest.js';
import type { PayOrderRequest } from './generated/shop/v1/PayOrderRequest.js';
import type { Order__Output as Order } from './generated/shop/v1/Order.js';
import type { Payment__Output as Payment } from './generated/shop/v1/Payment.js';
import type { OrderSummary__Output as OrderSummary } from './generated/shop/v1/OrderSummary.js';

// Nest wraps the generated contract in Observable-based methods.
export interface ShopRpc {
  getOrder(request: GetOrderRequest, metadata?: Metadata, options?: CallOptions): Observable<Order>;
  payOrder(request: PayOrderRequest, metadata?: Metadata, options?: CallOptions): Observable<Payment>;
  listOrders(request: ListOrdersRequest, metadata?: Metadata, options?: CallOptions): Observable<Order>;
  summarizeOrders(request: Observable<GetOrderRequest>, metadata?: Metadata): Observable<OrderSummary>;
  trackPayments(request: Observable<GetPaymentRequest>, metadata?: Metadata): Observable<Payment>;
}

export function deadline(ms = 5000): CallOptions { return { deadline: new Date(Date.now() + ms) }; }

// Nest's Observable request-stream adapter does not forward per-call options.
// A gRPC service config applies an actual deadline to every RPC, including streams.
export function clientGrpcOptions(target: string, timeoutSeconds = 5) {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1) throw new Error('timeoutSeconds must be a positive integer');
  const options = grpcOptions(target);
  options.options.channelOptions = {
    'grpc.service_config': JSON.stringify({ methodConfig: [{
      name: [{ service: 'shop.v1.ShopService' }], timeout: `${timeoutSeconds}s`,
    }] }),
  };
  return options;
}

@Injectable()
export class ShopClient implements OnModuleInit {
  rpc!: ShopRpc;
  constructor(@Inject('SHOP') private readonly client: ClientGrpc & ClientProxy) {}
  onModuleInit() { this.rpc = this.client.getService<ShopRpc>('ShopService'); }
}

@Module({
  imports: [ClientsModule.register([{ name: 'SHOP', ...clientGrpcOptions(process.env.GRPC_TARGET ?? 'localhost:50053') }])],
  providers: [ShopClient], exports: [ShopClient],
})
export class ClientModule {}
