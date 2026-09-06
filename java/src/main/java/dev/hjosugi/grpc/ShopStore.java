package dev.hjosugi.grpc;

import com.google.protobuf.util.JsonFormat;
import dev.hjosugi.grpc.proto.*;
import io.grpc.Status;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Service;

@Service
@Profile("!client")
public class ShopStore {
    private record Receipt(String orderId, String method, Payment payment) {}
    private final List<Order> orders;
    private final Map<String, Receipt> keys = new HashMap<>();
    private final Set<String> paid = new HashSet<>();
    private final Map<String, Payment> payments = new HashMap<>();

    public ShopStore(@Value("${demo.fixtures}") String fixturePath) throws IOException {
        var fixture = OrdersFixture.newBuilder();
        JsonFormat.parser().merge(Files.readString(Path.of(fixturePath)), fixture);
        orders = List.copyOf(fixture.getOrdersList());
        var seen = new HashSet<String>();
        for (var o : orders) {
            if (o.getOrderId().isEmpty() || !seen.add(o.getOrderId()) || o.getQuantity() <= 0
                    || o.getQuantity() > 10000 || o.getUnitPriceYen() <= 0 || o.getUnitPriceYen() > 100000000
                    || o.getTotalYen() != (long) o.getQuantity() * o.getUnitPriceYen()) {
                throw new IllegalArgumentException("invalid order fixture");
            }
        }
    }

    public Order get(String id) {
        if (id.isEmpty()) throw Status.INVALID_ARGUMENT.withDescription("order_id is required").asRuntimeException();
        return orders.stream().filter(o -> o.getOrderId().equals(id)).findFirst()
                .orElseThrow(() -> Status.NOT_FOUND.withDescription("order not found").asRuntimeException());
    }

    public List<Order> list(String customer) {
        return orders.stream().filter(o -> customer.isEmpty() || o.getCustomerId().equals(customer)).toList();
    }

    // This lock protects the entire check-and-insert, not only Map.put().
    public synchronized Payment pay(PayOrderRequest r) {
        if (!r.getIdempotencyKey().matches("[A-Za-z0-9_-]{1,64}")) {
            throw Status.INVALID_ARGUMENT.withDescription("idempotency_key must match [A-Za-z0-9_-]{1,64}").asRuntimeException();
        }
        if (!Set.of("card", "bank_transfer", "declined").contains(r.getPaymentMethod())) {
            throw Status.INVALID_ARGUMENT.withDescription("unsupported payment_method").asRuntimeException();
        }
        var order = get(r.getOrderId());
        var old = keys.get(r.getIdempotencyKey());
        if (old != null) {
            if (!old.orderId().equals(r.getOrderId()) || !old.method().equals(r.getPaymentMethod())) {
                throw Status.ALREADY_EXISTS.withDescription("idempotency_key was used for another request").asRuntimeException();
            }
            return old.payment();
        }
        if (paid.contains(r.getOrderId())) throw Status.FAILED_PRECONDITION.withDescription("order is already paid").asRuntimeException();
        if (r.getPaymentMethod().equals("declined")) throw Status.FAILED_PRECONDITION.withDescription("demo payment declined").asRuntimeException();
        if (keys.size() >= 10000) throw Status.RESOURCE_EXHAUSTED.withDescription("demo receipt limit reached").asRuntimeException();
        var payment = Payment.newBuilder().setPaymentId("pay-" + r.getIdempotencyKey())
                .setOrderId(r.getOrderId()).setAmountYen(order.getTotalYen())
                .setStatus(PaymentStatus.PAYMENT_STATUS_PAID).build();
        keys.put(r.getIdempotencyKey(), new Receipt(r.getOrderId(), r.getPaymentMethod(), payment));
        paid.add(r.getOrderId());
        payments.put(payment.getPaymentId(), payment);
        return payment;
    }

    public synchronized Payment payment(String id) {
        if (id.isEmpty()) throw Status.INVALID_ARGUMENT.withDescription("payment_id is required").asRuntimeException();
        var payment = payments.get(id);
        if (payment == null) throw Status.NOT_FOUND.withDescription("payment not found").asRuntimeException();
        return payment;
    }
}
