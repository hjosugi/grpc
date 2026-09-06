# Design a Payment RPC Service

## 30-sec summary

I would define a typed API with Protocol Buffers and use gRPC for service-to-service calls.
Each payment request includes an idempotency key.
I would set a deadline and store the payment result with the key in one database transaction.
The demo uses memory. A production service needs durable storage and coordination with the payment provider.

## Clarifying questions

- What is the peak request rate?
- What is the latency target?
- Which payment provider do we use?
- How long must we keep idempotency records?
- Do clients need polling or live updates?

## Requirements

- Read orders and create payments.
- Return the same result for the same successful request and key.
- Reject a reused key with a different request.
- Handle timeouts without creating duplicate charges.
- Protect customer data and payment credentials.

## High-level design

The order service calls the payment service through a generated gRPC client.
The payment service validates the request and checks an idempotency table.
A database stores the payment state. A separate adapter calls the payment provider.
The client reuses its channel and sends a deadline with each request.

## Deep dive 1

The key idea is durable idempotency.
A unique constraint prevents two requests from creating the same operation.
We also store a request fingerprint. A changed request with the same key is rejected.
An in-memory lock only protects one process.

## Deep dive 2

A timeout does not mean the payment failed.
The payment may have completed before the response was lost.
The client should check the existing operation or retry with the same key.
The payment provider should also support idempotency. Otherwise, we need reconciliation for uncertain outcomes.

## Deep dive 3

Unary calls are enough to create a payment.
Server streaming can send a sequence of updates.
For long streams, I would define limits, backpressure, reconnect behavior, and a resume position.
The demo's bidirectional method performs repeated lookups. It does not push live state changes.

## Tradeoffs

gRPC gives typed contracts and streaming, but browser clients need additional support.
Blocking clients are simple, while async clients help when many calls are active.
A longer idempotency retention period improves retry safety but uses more storage.

## Failure cases

- The payment succeeds, but the response is lost.
- Two requests use the same key at the same time.
- The same key is reused with a different amount or order.
- The database commits, but the external provider's result is unknown.
- The server restarts during a request.
- A slow client cannot consume a stream fast enough.

## 2-min English answer

I would use Protocol Buffers to define the payment API.
The order service would call it through a generated gRPC client.
This gives both services the same request and response types.

The main challenge is avoiding duplicate charges.
Each request would include an idempotency key.
I would store the key, a request fingerprint, and the payment state in a database.
A unique constraint would protect concurrent requests.
If the same request arrives again, I would return the existing result.
If the request is different, I would reject it.

Every call needs a deadline.
However, a timeout does not prove that the payment failed.
The server may have completed the payment before the connection was lost.
The client should retry with the same key or check the existing payment.
I would also use the payment provider's idempotency feature and reconcile uncertain results.

I would start with unary calls for payment creation.
If clients need updates, I would consider server streaming.
For long streams, I would define backpressure, message limits, and reconnect behavior.

Finally, I would add TLS, authorization, metrics, and tracing.
I would test normal requests, concurrent retries, deadlines, and failures between steps.
