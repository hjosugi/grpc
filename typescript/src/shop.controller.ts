import { Controller, Inject } from '@nestjs/common';
import { GrpcMethod, GrpcStreamMethod } from '@nestjs/microservices';
import { Metadata, type ServerUnaryCall, status } from '@grpc/grpc-js';
import { from, fromEvent, map, Observable, reduce, takeUntil, timer } from 'rxjs';
import { rpcError, ShopStore } from './shop.store.js';
import type { GetOrderRequest__Output as GetOrderRequest } from './generated/shop/v1/GetOrderRequest.js';
import type { GetPaymentRequest__Output as GetPaymentRequest } from './generated/shop/v1/GetPaymentRequest.js';
import type { ListOrdersRequest__Output as ListOrdersRequest } from './generated/shop/v1/ListOrdersRequest.js';
import type { PayOrderRequest__Output as PayOrderRequest } from './generated/shop/v1/PayOrderRequest.js';
import type { Order__Output as Order } from './generated/shop/v1/Order.js';

@Controller()
export class ShopController {
  private readonly delay = Number(process.env.DEMO_DELAY_MS ?? 0);
  constructor(@Inject(ShopStore) private readonly store: ShopStore) {
    if (!Number.isInteger(this.delay) || this.delay < 0 || this.delay > 5000) throw new Error('DEMO_DELAY_MS must be 0..5000');
  }

  @GrpcMethod('ShopService', 'GetOrder')
  getOrder(request: GetOrderRequest, _metadata: Metadata, call: ServerUnaryCall<GetOrderRequest, Order>) {
    return timer(this.delay).pipe(map(() => this.store.get(request.order_id)), takeUntil(fromEvent(call, 'cancelled')));
  }

  @GrpcMethod('ShopService', 'PayOrder')
  payOrder(request: PayOrderRequest) { return this.store.pay(request); }

  @GrpcMethod('ShopService', 'ListOrders')
  listOrders(request: ListOrdersRequest) { return from(this.store.list(request.customer_id)); }

  @GrpcStreamMethod('ShopService', 'SummarizeOrders')
  summarizeOrders(requests: Observable<GetOrderRequest>) {
    return requests.pipe(reduce((summary, request) => {
      if (summary.order_count === 1000) rpcError(status.RESOURCE_EXHAUSTED, 'stream is limited to 1000 items');
      return { order_count: summary.order_count + 1,
        total_yen: summary.total_yen + BigInt(this.store.get(request.order_id).total_yen) };
    }, { order_count: 0, total_yen: 0n }),
    map(summary => ({ ...summary, total_yen: summary.total_yen.toString() })));
  }

  @GrpcStreamMethod('ShopService', 'TrackPayments')
  trackPayments(requests: Observable<GetPaymentRequest>) {
    return requests.pipe(map((request, index) => {
      if (index === 1000) rpcError(status.RESOURCE_EXHAUSTED, 'stream is limited to 1000 items');
      return this.store.payment(request.payment_id);
    }));
  }
}
