import 'reflect-metadata';
import assert from 'node:assert/strict';
import { before, after, describe, it } from 'node:test';
import { createServer } from 'node:net';
import { Test } from '@nestjs/testing';
import { ClientsModule } from '@nestjs/microservices';
import { firstValueFrom, Subject } from 'rxjs';
import type { INestMicroservice } from '@nestjs/common';
import * as grpc from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { AppModule } from '../src/app.module.js';
import { grpcOptions, loader, protoPath } from '../src/config.js';
import { clientGrpcOptions, ShopClient } from '../src/shop.client.js';
import type { ProtoGrpcType } from '../src/generated/shop.js';
import type { ShopServiceClient } from '../src/generated/shop/v1/ShopService.js';
import type { Order__Output } from '../src/generated/shop/v1/Order.js';
import type { Payment__Output } from '../src/generated/shop/v1/Payment.js';
import type { OrderSummary__Output } from '../src/generated/shop/v1/OrderSummary.js';

const deadline = () => ({ deadline: new Date(Date.now() + 5000) });
const metadata = new grpc.Metadata();
metadata.set('x-request-id', 'contract-test');

function collect<T>(stream: grpc.ClientReadableStream<T>): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const values: T[] = [];
    stream.on('data', value => values.push(value));
    stream.on('error', reject);
    stream.on('end', () => resolve(values));
  });
}

function hasCode(code: grpc.status) {
  return (error: unknown) => (error as grpc.ServiceError).code === code;
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  return address.port;
}

describe('shared gRPC wire contract', { timeout: 30000 }, () => {
  let app: INestMicroservice | undefined;
  let client: ShopServiceClient;
  let target: string;
  before(async () => {
    target = process.env.GRPC_TARGET ?? '';
    if (!target) {
      target = `127.0.0.1:${await unusedPort()}`;
      const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
      app = module.createNestMicroservice({ ...grpcOptions(target), logger: false });
      await app.listen();
    }
    const proto = grpc.loadPackageDefinition(loadSync(protoPath, loader)) as unknown as ProtoGrpcType;
    client = new proto.shop.v1.ShopService(target, grpc.credentials.createInsecure());
    await new Promise<void>((resolve, reject) => client.waitForReady(Date.now() + 10000, err => err ? reject(err) : resolve()));
  });
  after(async () => { client?.close(); await app?.close(); });

  const get = (id: string) => new Promise<Order__Output>((resolve, reject) => client.getOrder({ order_id: id }, metadata, deadline(), (error, result) => error ? reject(error) : resolve(result!)));
  const pay = (order_id: string, idempotency_key: string, payment_method = 'card') => new Promise<Payment__Output>((resolve, reject) => client.payOrder({ order_id, idempotency_key, payment_method }, metadata, deadline(), (error, result) => error ? reject(error) : resolve(result!)));
  const summarize = (ids: string[]) => new Promise<OrderSummary__Output>((resolve, reject) => {
    const stream = client.summarizeOrders(metadata, deadline(), (error, result) => error ? reject(error) : resolve(result!));
    stream.on('error', reject);
    for (const order_id of ids) stream.write({ order_id });
    stream.end();
  });

  it('returns the shared fixture with exact int64 strings', async () => {
    for (const [id, quantity, total] of [['ord-1001', 1, '9800'], ['ord-1002', 2, '7000'], ['ord-1003', 1, '42000']] as const) {
      const order = await get(id);
      assert.equal(order.quantity, quantity);
      assert.equal(order.total_yen, total);
      assert.equal(BigInt(order.quantity) * BigInt(order.unit_price_yen), BigInt(order.total_yen));
    }
  });

  it('returns INVALID_ARGUMENT and NOT_FOUND', async () => {
    await assert.rejects(get(''), hasCode(grpc.status.INVALID_ARGUMENT));
    await assert.rejects(get('missing'), hasCode(grpc.status.NOT_FOUND));
    await assert.rejects(pay('ord-1001', ''), hasCode(grpc.status.INVALID_ARGUMENT));
    await assert.rejects(pay('ord-1001', 'invalid key'), hasCode(grpc.status.INVALID_ARGUMENT));
    await assert.rejects(pay('ord-1001', 'invalid-method', 'cash'), hasCode(grpc.status.INVALID_ARGUMENT));
    await assert.rejects(pay('missing', 'valid-key'), hasCode(grpc.status.NOT_FOUND));
  });

  it('replays a payment and rejects changed payloads or a second key', async () => {
    const payment = await pay('ord-1001', 'demo-pay-1001');
    assert.equal(payment.payment_id, 'pay-demo-pay-1001');
    assert.equal(payment.amount_yen, '9800');
    assert.equal(payment.status, 'PAYMENT_STATUS_PAID');
    assert.deepEqual(await pay('ord-1001', 'demo-pay-1001'), payment);
    await assert.rejects(pay('ord-1002', 'demo-pay-1001'), hasCode(grpc.status.ALREADY_EXISTS));
    await assert.rejects(pay('ord-1001', 'demo-pay-1001', 'bank_transfer'), hasCode(grpc.status.ALREADY_EXISTS));
    await assert.rejects(pay('ord-1001', 'another-key'), hasCode(grpc.status.FAILED_PRECONDITION));
  });

  it('handles 32 concurrent replays atomically', async () => {
    const responses = await Promise.all(Array.from({ length: 32 }, () => pay('ord-1002', 'parallel-1002')));
    assert.equal(new Set(responses.map(p => p.payment_id)).size, 1);
    assert(responses.every(p => p.amount_yen === '7000'));
  });

  it('does not mark a declined payment as paid', async () => {
    await assert.rejects(pay('ord-1003', 'declined-1003', 'declined'), hasCode(grpc.status.FAILED_PRECONDITION));
    const payment = await pay('ord-1003', 'bank-1003', 'bank_transfer');
    assert.equal(payment.amount_yen, '42000');
  });

  it('streams orders in fixture order and supports empty results', async () => {
    const orders = await collect(client.listOrders({ customer_id: 'customer-001' }, metadata, deadline()));
    assert.deepEqual(orders.map(o => o.order_id), ['ord-1001', 'ord-1002']);
    assert.equal((await collect(client.listOrders({}, metadata, deadline()))).length, 3);
    assert.deepEqual(await collect(client.listOrders({ customer_id: 'missing' }, metadata, deadline())), []);
  });

  it('aggregates client streams, including an empty stream', async () => {
    assert.deepEqual(await summarize(['ord-1001', 'ord-1002']), { order_count: 2, total_yen: '16800' });
    assert.deepEqual(await summarize([]), { order_count: 0, total_yen: '0' });
    assert.deepEqual(await summarize(['ord-1001', 'ord-1001']), { order_count: 2, total_yen: '19600' });
    await assert.rejects(summarize(['missing']), hasCode(grpc.status.NOT_FOUND));
    await assert.rejects(summarize(Array(1001).fill('ord-1001')), hasCode(grpc.status.RESOURCE_EXHAUSTED));
  });

  it('returns bidi responses before half-close, in order', async () => {
    await new Promise<void>((resolve, reject) => {
      const stream = client.trackPayments(metadata, deadline());
      let count = 0;
      stream.on('error', reject);
      stream.on('data', (payment: Payment__Output) => {
        try {
          assert.equal(payment.payment_id, count === 0 ? 'pay-demo-pay-1001' : 'pay-parallel-1002');
          if (++count === 1) stream.write({ payment_id: 'pay-parallel-1002' });
          else stream.end();
        } catch (e) { stream.cancel(); reject(e); }
      });
      stream.on('end', () => { try { assert.equal(count, 2); resolve(); } catch (e) { reject(e); } });
      stream.write({ payment_id: 'pay-demo-pay-1001' });
    });
  });

  it('ends empty bidi streams and reports invalid payment IDs', async () => {
    const empty = client.trackPayments(metadata, deadline());
    const result = collect(empty); empty.end(); assert.deepEqual(await result, []);
    const missing = client.trackPayments(metadata, deadline());
    const rejected = assert.rejects(collect(missing), hasCode(grpc.status.NOT_FOUND));
    missing.write({ payment_id: 'missing' }); missing.end(); await rejected;
  });

  it('returns real deadline and cancellation statuses', async () => {
    await assert.rejects(new Promise((resolve, reject) => {
      client.getOrder({ order_id: 'ord-1001' }, { deadline: new Date(0) }, (error, result) => error ? reject(error) : resolve(result));
    }), hasCode(grpc.status.DEADLINE_EXCEEDED));
    await assert.rejects(new Promise((resolve, reject) => {
      const call = client.getOrder({ order_id: 'ord-1001' }, deadline(), (error, result) => error ? reject(error) : resolve(result));
      call.cancel();
    }), hasCode(grpc.status.CANCELLED));
    await get('ord-1001');
  });

  it('bounds idle Nest request streams with the configured gRPC timeout', async () => {
    const module = await Test.createTestingModule({
      imports: [ClientsModule.register([{ name: 'SHOP', ...clientGrpcOptions(target, 1) }])],
      providers: [ShopClient],
    }).compile();
    try {
      await module.init();
      const rpc = module.get(ShopClient).rpc;
      assert.equal((await firstValueFrom(rpc.getOrder({ order_id: 'ord-1001' }))).total_yen, '9800');
      for (const request of [() => rpc.summarizeOrders(new Subject()), () => rpc.trackPayments(new Subject())]) {
        const started = Date.now();
        // The server may reset the stream as its propagated deadline expires,
        // racing the client timer. Both terminal statuses must still be bounded.
        await assert.rejects(firstValueFrom<unknown>(request()), error =>
          [grpc.status.DEADLINE_EXCEEDED, grpc.status.CANCELLED].includes((error as grpc.ServiceError).code));
        assert(Date.now() - started >= 800, 'stream ended before the configured timeout');
        assert(Date.now() - started < 4000, 'stream outlived the configured timeout');
      }
    } finally { await module.close(); }
  });
});
