import { readFileSync } from 'node:fs';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import type { Order__Output as Order } from './generated/shop/v1/Order.js';
import type { Payment__Output as Payment } from './generated/shop/v1/Payment.js';
import type { PayOrderRequest__Output as PayOrderRequest } from './generated/shop/v1/PayOrderRequest.js';

export function rpcError(code: status, message: string): never {
  throw new RpcException({ code, message });
}

export function loadOrders(path: string): Order[] {
  const data = JSON.parse(readFileSync(path, 'utf8')) as { orders: Order[] };
  if (!Array.isArray(data.orders)) throw new Error('invalid order fixture');
  const seen = new Set<string>();
  for (const o of data.orders) {
    if (typeof o.order_id !== 'string' || !o.order_id || seen.has(o.order_id)
      || !Number.isInteger(o.quantity) || o.quantity <= 0 || o.quantity > 10000
      || typeof o.unit_price_yen !== 'string' || !/^[0-9]+$/.test(o.unit_price_yen)
      || BigInt(o.unit_price_yen) <= 0n || BigInt(o.unit_price_yen) > 100000000n
      || typeof o.total_yen !== 'string' || BigInt(o.total_yen) !== BigInt(o.quantity) * BigInt(o.unit_price_yen)) {
      throw new Error('invalid order fixture');
    }
    seen.add(o.order_id);
  }
  return data.orders;
}

export class ShopStore {
  private readonly keys = new Map<string, { orderId: string; method: string; payment: Payment }>();
  private readonly paid = new Set<string>();
  private readonly payments = new Map<string, Payment>();
  private readonly orders: Order[];

  constructor(orders: Order[]) { this.orders = orders.map(o => ({ ...o })); }

  get(id: string): Order {
    if (!id) rpcError(status.INVALID_ARGUMENT, 'order_id is required');
    const order = this.orders.find(o => o.order_id === id);
    if (!order) rpcError(status.NOT_FOUND, 'order not found');
    return { ...order };
  }

  list(customer: string): Order[] {
    return this.orders.filter(o => !customer || o.customer_id === customer).map(o => ({ ...o }));
  }

  // No await between the check and insert. This is atomic in one Node process.
  pay(request: PayOrderRequest): Payment {
    const { order_id, payment_method, idempotency_key } = request;
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(idempotency_key)) rpcError(status.INVALID_ARGUMENT, 'idempotency_key must match [A-Za-z0-9_-]{1,64}');
    if (!['card', 'bank_transfer', 'declined'].includes(payment_method)) rpcError(status.INVALID_ARGUMENT, 'unsupported payment_method');
    const order = this.get(order_id);
    const old = this.keys.get(idempotency_key);
    if (old) {
      if (old.orderId !== order_id || old.method !== payment_method) rpcError(status.ALREADY_EXISTS, 'idempotency_key was used for another request');
      return { ...old.payment };
    }
    if (this.paid.has(order_id)) rpcError(status.FAILED_PRECONDITION, 'order is already paid');
    if (payment_method === 'declined') rpcError(status.FAILED_PRECONDITION, 'demo payment declined');
    if (this.keys.size >= 10000) rpcError(status.RESOURCE_EXHAUSTED, 'demo receipt limit reached');
    const payment: Payment = { payment_id: `pay-${idempotency_key}`, order_id,
      amount_yen: order.total_yen, status: 'PAYMENT_STATUS_PAID' };
    this.keys.set(idempotency_key, { orderId: order_id, method: payment_method, payment });
    this.paid.add(order_id);
    this.payments.set(payment.payment_id, payment);
    return { ...payment };
  }

  payment(id: string): Payment {
    if (!id) rpcError(status.INVALID_ARGUMENT, 'payment_id is required');
    const payment = this.payments.get(id);
    if (!payment) rpcError(status.NOT_FOUND, 'payment not found');
    return { ...payment };
  }
}
