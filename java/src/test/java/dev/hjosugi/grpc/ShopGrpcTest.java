package dev.hjosugi.grpc;

import dev.hjosugi.grpc.proto.*;
import io.grpc.Status;
import io.grpc.StatusRuntimeException;
import java.util.ArrayList;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.grpc.test.autoconfigure.AutoConfigureTestGrpcTransport;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.grpc.client.ImportGrpcClients;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest(properties = "demo.delay-ms=100")
@AutoConfigureTestGrpcTransport
@ImportGrpcClients(types = {ShopServiceGrpc.ShopServiceBlockingStub.class, ShopServiceGrpc.ShopServiceStub.class})
class ShopGrpcTest {
    @Autowired ShopServiceGrpc.ShopServiceBlockingStub client;
    @Autowired ShopServiceGrpc.ShopServiceStub async;

    @Test
    void unaryAndErrorCodes() {
        assertThat(client.withDeadlineAfter(5, TimeUnit.SECONDS).getOrder(GetOrderRequest.newBuilder().setOrderId("ord-1002").build()).getTotalYen()).isEqualTo(7000);
        for (var id : new String[]{"", "missing"}) {
            var error = catchThrowableOfType(StatusRuntimeException.class, () -> client.withDeadlineAfter(5, TimeUnit.SECONDS).getOrder(GetOrderRequest.newBuilder().setOrderId(id).build()));
            assertThat(error.getStatus().getCode()).isEqualTo(id.isEmpty() ? Status.Code.INVALID_ARGUMENT : Status.Code.NOT_FOUND);
        }
    }

    @Test
    void concurrentReplayAndConflict() throws Exception {
        var request = PayOrderRequest.newBuilder().setOrderId("ord-1001").setPaymentMethod("card").setIdempotencyKey("java-test").build();
        var executor = Executors.newFixedThreadPool(8);
        try {
            var tasks = new ArrayList<Callable<Payment>>();
            for (int i = 0; i < 32; i++) tasks.add(() -> client.withDeadlineAfter(5, TimeUnit.SECONDS).payOrder(request));
            for (var future : executor.invokeAll(tasks)) assertThat(future.get().getPaymentId()).isEqualTo("pay-java-test");
        } finally { executor.shutdownNow(); }
        var conflict = catchThrowableOfType(StatusRuntimeException.class, () -> client.withDeadlineAfter(5, TimeUnit.SECONDS).payOrder(request.toBuilder().setOrderId("ord-1002").build()));
        assertThat(conflict.getStatus().getCode()).isEqualTo(Status.Code.ALREADY_EXISTS);
        var paid = catchThrowableOfType(StatusRuntimeException.class, () -> client.withDeadlineAfter(5, TimeUnit.SECONDS).payOrder(request.toBuilder().setIdempotencyKey("different").build()));
        assertThat(paid.getStatus().getCode()).isEqualTo(Status.Code.FAILED_PRECONDITION);
    }

    @Test
    void allStreamingShapes() throws Exception {
        var listed = new ArrayList<Order>();
        client.withDeadlineAfter(5, TimeUnit.SECONDS).listOrders(ListOrdersRequest.newBuilder().setCustomerId("customer-001").build()).forEachRemaining(listed::add);
        assertThat(listed).hasSize(2);
        for (int count : new int[]{0, 2}) {
            var responses = new ClientConfiguration.Responses<OrderSummary>();
            var stream = async.withDeadlineAfter(5, TimeUnit.SECONDS).summarizeOrders(responses);
            for (int i = 1; i <= count; i++) stream.onNext(GetOrderRequest.newBuilder().setOrderId("ord-100" + i).build());
            stream.onCompleted(); responses.awaitEnd();
            var result = responses.next();
            assertThat(result.getOrderCount()).isEqualTo(count);
            assertThat(result.getTotalYen()).isEqualTo(count == 0 ? 0 : 16800);
        }
        var payment = client.withDeadlineAfter(5, TimeUnit.SECONDS).payOrder(PayOrderRequest.newBuilder().setOrderId("ord-1003").setPaymentMethod("card").setIdempotencyKey("java-stream").build());
        var tracked = new ClientConfiguration.Responses<Payment>();
        var stream = async.withDeadlineAfter(5, TimeUnit.SECONDS).trackPayments(tracked);
        for (int i = 0; i < 2; i++) {
            stream.onNext(GetPaymentRequest.newBuilder().setPaymentId(payment.getPaymentId()).build());
            assertThat(tracked.next()).isEqualTo(payment);
        }
        stream.onCompleted(); tracked.awaitEnd();
    }

    @Test
    void deadlineIsARealGrpcStatus() {
        var error = catchThrowableOfType(StatusRuntimeException.class, () -> client.withDeadlineAfter(10, TimeUnit.MILLISECONDS).getOrder(GetOrderRequest.newBuilder().setOrderId("ord-1001").build()));
        assertThat(error.getStatus().getCode()).isEqualTo(Status.Code.DEADLINE_EXCEEDED);
    }
}
