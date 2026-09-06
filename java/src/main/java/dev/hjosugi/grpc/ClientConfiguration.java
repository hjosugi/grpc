package dev.hjosugi.grpc;

import com.google.protobuf.MessageOrBuilder;
import com.google.protobuf.util.JsonFormat;
import dev.hjosugi.grpc.proto.*;
import io.grpc.stub.StreamObserver;
import java.util.concurrent.*;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.*;
import org.springframework.grpc.client.ImportGrpcClients;

@Configuration(proxyBeanMethods = false)
@Profile("client")
@ImportGrpcClients(target = "shop", types = {ShopServiceGrpc.ShopServiceBlockingStub.class, ShopServiceGrpc.ShopServiceStub.class})
public class ClientConfiguration {
    private static void show(String label, MessageOrBuilder message) throws Exception {
        System.out.println(label + " " + JsonFormat.printer().omittingInsignificantWhitespace().print(message));
    }

    @Bean
    ApplicationRunner demo(ShopServiceGrpc.ShopServiceBlockingStub blocking, ShopServiceGrpc.ShopServiceStub async) {
        return args -> {
            show("order", blocking.withDeadlineAfter(5, TimeUnit.SECONDS).getOrder(GetOrderRequest.newBuilder().setOrderId("ord-1001").build()));
            var request = PayOrderRequest.newBuilder().setOrderId("ord-1001").setPaymentMethod("card").setIdempotencyKey("demo-pay-1001").build();
            var payment = blocking.withDeadlineAfter(5, TimeUnit.SECONDS).payOrder(request);
            show("payment", payment);
            if (!payment.equals(blocking.withDeadlineAfter(5, TimeUnit.SECONDS).payOrder(request))) throw new IllegalStateException("idempotency failed");
            var orders = blocking.withDeadlineAfter(5, TimeUnit.SECONDS).listOrders(ListOrdersRequest.newBuilder().setCustomerId("customer-001").build());
            while (orders.hasNext()) show("listed", orders.next());
            var summary = new Responses<OrderSummary>();
            var input = async.withDeadlineAfter(5, TimeUnit.SECONDS).summarizeOrders(summary);
            input.onNext(GetOrderRequest.newBuilder().setOrderId("ord-1001").build());
            input.onNext(GetOrderRequest.newBuilder().setOrderId("ord-1002").build());
            input.onCompleted();
            summary.awaitEnd();
            var total = summary.next();
            show("summary", total);
            if (total.getOrderCount() != 2 || total.getTotalYen() != 16800 || payment.getAmountYen() != 9800) throw new IllegalStateException("unexpected demo result");
            var tracked = new Responses<Payment>();
            var tracking = async.withDeadlineAfter(5, TimeUnit.SECONDS).trackPayments(tracked);
            for (int i = 0; i < 2; i++) {
                tracking.onNext(GetPaymentRequest.newBuilder().setPaymentId(payment.getPaymentId()).build());
                show("tracked", tracked.next());
            }
            tracking.onCompleted();
            tracked.awaitEnd();
            System.out.println("DEMO_OK");
        };
    }

    static class Responses<T> implements StreamObserver<T> {
        private final BlockingQueue<T> values = new LinkedBlockingQueue<>();
        private final CountDownLatch completed = new CountDownLatch(1);
        private volatile Throwable error;
        public void onNext(T value) { values.add(value); }
        public void onError(Throwable error) { this.error = error; completed.countDown(); }
        public void onCompleted() { completed.countDown(); }
        T next() throws Exception {
            var value = values.poll(6, TimeUnit.SECONDS);
            if (error != null) throw new IllegalStateException(error);
            if (value == null) throw new TimeoutException("no stream response");
            return value;
        }
        void awaitEnd() throws Exception {
            if (!completed.await(6, TimeUnit.SECONDS)) throw new TimeoutException("stream did not finish");
            if (error != null) throw new IllegalStateException(error);
        }
    }
}
