import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Metadata } from '@grpc/grpc-js';
import { firstValueFrom, from, lastValueFrom, ReplaySubject, toArray } from 'rxjs';
import { ClientModule, deadline, ShopClient } from './shop.client.js';
import type { GetPaymentRequest } from './generated/shop/v1/GetPaymentRequest.js';

const app = await NestFactory.createApplicationContext(ClientModule, { logger: false });
try {
  const rpc = app.get(ShopClient).rpc;
  const metadata = new Metadata();
  metadata.set('x-request-id', 'demo-typescript');
  console.log('order', await firstValueFrom(rpc.getOrder({ order_id: 'ord-1001' }, metadata, deadline())));
  const request = { order_id: 'ord-1001', payment_method: 'card', idempotency_key: 'demo-pay-1001' };
  const payment = await firstValueFrom(rpc.payOrder(request, metadata, deadline()));
  console.log('payment', payment);
  const replay = await firstValueFrom(rpc.payOrder(request, metadata, deadline()));
  if (payment.payment_id !== replay.payment_id) throw new Error('idempotency failed');
  console.log('listed', await lastValueFrom(rpc.listOrders({ customer_id: 'customer-001' }, metadata, deadline()).pipe(toArray())));
  const total = await firstValueFrom(rpc.summarizeOrders(from([{ order_id: 'ord-1001' }, { order_id: 'ord-1002' }]), metadata));
  console.log('summary', total);
  if (total.order_count !== 2 || total.total_yen !== '16800' || payment.amount_yen !== '9800') throw new Error('unexpected demo result');
  const input = new ReplaySubject<GetPaymentRequest>(2);
  const completed = new Promise<void>((resolve, reject) => {
    let count = 0;
    rpc.trackPayments(input, metadata).subscribe({
      next: response => {
        console.log('tracked', response);
        // Send the second request only after receiving the first response.
        if (++count === 1) input.next({ payment_id: payment.payment_id });
        else input.complete();
      }, error: reject, complete: resolve,
    });
  });
  input.next({ payment_id: payment.payment_id });
  await completed;
  console.log('DEMO_OK');
} finally { await app.close(); }
