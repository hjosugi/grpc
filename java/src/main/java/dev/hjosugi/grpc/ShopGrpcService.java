package dev.hjosugi.grpc;

import dev.hjosugi.grpc.proto.*;
import io.grpc.Context;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import io.grpc.stub.ServerCallStreamObserver;
import io.grpc.stub.StreamObserver;
import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.grpc.server.service.GrpcService;

@GrpcService
@Profile("!client")
public class ShopGrpcService extends ShopServiceGrpc.ShopServiceImplBase {
    private final ShopStore store;
    private final long delayMs;

    public ShopGrpcService(ShopStore store, @Value("${demo.delay-ms:0}") long delayMs) {
        if (delayMs < 0 || delayMs > 5000) throw new IllegalArgumentException("DEMO_DELAY_MS must be 0..5000");
        this.store = store;
        this.delayMs = delayMs;
    }

    private static void fail(StreamObserver<?> out, RuntimeException error) {
        out.onError(error instanceof StatusRuntimeException ? error : Status.INTERNAL.withDescription("internal error").asRuntimeException());
    }

    private static <T> void reply(StreamObserver<T> out, Supplier<T> action) {
        try { out.onNext(action.get()); out.onCompleted(); }
        catch (RuntimeException e) { fail(out, e); }
    }

    @Override
    public void getOrder(GetOrderRequest request, StreamObserver<Order> out) {
        reply(out, () -> {
            // Optional read-only latency injection for the deadline exercise.
            long remaining = delayMs;
            while (remaining > 0) {
                if (Context.current().isCancelled()) throw Status.CANCELLED.asRuntimeException();
                long slice = Math.min(remaining, 10);
                try { Thread.sleep(slice); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); throw Status.CANCELLED.asRuntimeException(); }
                remaining -= slice;
            }
            return store.get(request.getOrderId());
        });
    }

    @Override
    public void payOrder(PayOrderRequest request, StreamObserver<Payment> out) {
        reply(out, () -> {
            if (Context.current().isCancelled()) throw Status.CANCELLED.asRuntimeException();
            return store.pay(request);
        });
    }

    @Override
    public void listOrders(ListOrdersRequest request, StreamObserver<Order> out) {
        try {
            for (var order : store.list(request.getCustomerId())) {
                if (((ServerCallStreamObserver<Order>) out).isCancelled()) return;
                out.onNext(order);
            }
            out.onCompleted();
        } catch (RuntimeException e) { fail(out, e); }
    }

    @Override
    public StreamObserver<GetOrderRequest> summarizeOrders(StreamObserver<OrderSummary> out) {
        return new StreamObserver<>() {
            private int count;
            private long total;
            private boolean done;
            public void onNext(GetOrderRequest request) {
                if (done) return;
                try {
                    if (count == 1000) throw Status.RESOURCE_EXHAUSTED.withDescription("stream is limited to 1000 items").asRuntimeException();
                    var order = store.get(request.getOrderId());
                    count++;
                    total += order.getTotalYen();
                } catch (RuntimeException e) { done = true; fail(out, e); }
            }
            public void onError(Throwable error) { done = true; }
            public void onCompleted() {
                if (done) return;
                done = true;
                out.onNext(OrderSummary.newBuilder().setOrderCount(count).setTotalYen(total).build());
                out.onCompleted();
            }
        };
    }

    @Override
    public StreamObserver<GetPaymentRequest> trackPayments(StreamObserver<Payment> out) {
        return new StreamObserver<>() {
            private boolean done;
            private int count;
            public void onNext(GetPaymentRequest request) {
                if (done) return;
                try {
                    if (count++ == 1000) throw Status.RESOURCE_EXHAUSTED.withDescription("stream is limited to 1000 items").asRuntimeException();
                    out.onNext(store.payment(request.getPaymentId()));
                } catch (RuntimeException e) { done = true; fail(out, e); }
            }
            public void onError(Throwable error) { done = true; }
            public void onCompleted() { if (!done) { done = true; out.onCompleted(); } }
        };
    }
}
