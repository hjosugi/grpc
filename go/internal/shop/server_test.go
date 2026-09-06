package shop

import (
	"context"
	"io"
	"net"
	"sync"
	"testing"
	"time"

	pb "github.com/hjosugi/grpc/go/gen/shop/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
	"google.golang.org/grpc/test/bufconn"
)

func setup(t *testing.T, delay time.Duration) pb.ShopServiceClient {
	t.Helper()
	s, err := Load("../../../fixtures/orders.json")
	if err != nil {
		t.Fatal(err)
	}
	l := bufconn.Listen(1024 * 1024)
	server := grpc.NewServer()
	pb.RegisterShopServiceServer(server, &Server{Store: s, ReadDelay: delay})
	go func() { _ = server.Serve(l) }()
	c, err := grpc.NewClient("passthrough:///bufnet", grpc.WithTransportCredentials(insecure.NewCredentials()), grpc.WithContextDialer(func(context.Context, string) (net.Conn, error) { return l.Dial() }))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { c.Close(); server.Stop(); l.Close() })
	return pb.NewShopServiceClient(c)
}

func testContext(t *testing.T) context.Context {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)
	return ctx
}

func TestUnaryAndErrors(t *testing.T) {
	c := setup(t, 0)
	ctx := testContext(t)
	o, err := c.GetOrder(ctx, &pb.GetOrderRequest{OrderId: "ord-1002"})
	if err != nil || o.GetTotalYen() != 7000 {
		t.Fatalf("order: %v %v", o, err)
	}
	for _, tc := range []struct {
		id   string
		code codes.Code
	}{{"", codes.InvalidArgument}, {"missing", codes.NotFound}} {
		_, err := c.GetOrder(ctx, &pb.GetOrderRequest{OrderId: tc.id})
		if status.Code(err) != tc.code {
			t.Fatalf("status: %v", err)
		}
	}
}

func TestConcurrentIdempotencyAndConflict(t *testing.T) {
	c := setup(t, 0)
	ctx := testContext(t)
	r := &pb.PayOrderRequest{OrderId: "ord-1001", PaymentMethod: "card", IdempotencyKey: "concurrent"}
	var wg sync.WaitGroup
	for i := 0; i < 32; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			p, err := c.PayOrder(ctx, r)
			if err != nil || p.GetPaymentId() != "pay-concurrent" {
				t.Errorf("payment: %v %v", p, err)
			}
		}()
	}
	wg.Wait()
	_, err := c.PayOrder(ctx, &pb.PayOrderRequest{OrderId: "ord-1002", PaymentMethod: "card", IdempotencyKey: "concurrent"})
	if status.Code(err) != codes.AlreadyExists {
		t.Fatal(err)
	}
	_, err = c.PayOrder(ctx, &pb.PayOrderRequest{OrderId: "ord-1001", PaymentMethod: "card", IdempotencyKey: "another"})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatal(err)
	}
}

func TestAllStreamingShapes(t *testing.T) {
	c := setup(t, 0)
	ctx := testContext(t)
	stream, err := c.ListOrders(ctx, &pb.ListOrdersRequest{CustomerId: "customer-001"})
	if err != nil {
		t.Fatal(err)
	}
	count := 0
	for {
		_, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatal(err)
		}
		count++
	}
	if count != 2 {
		t.Fatal(count)
	}
	for _, ids := range [][]string{{}, {"ord-1001", "ord-1002"}} {
		s, err := c.SummarizeOrders(ctx)
		if err != nil {
			t.Fatal(err)
		}
		for _, id := range ids {
			if err := s.Send(&pb.GetOrderRequest{OrderId: id}); err != nil {
				t.Fatal(err)
			}
		}
		r, err := s.CloseAndRecv()
		if err != nil || r.GetOrderCount() != uint32(len(ids)) {
			t.Fatalf("summary: %v %v", r, err)
		}
		if len(ids) == 2 && r.TotalYen != 16800 {
			t.Fatal(r)
		}
	}
	p, err := c.PayOrder(ctx, &pb.PayOrderRequest{OrderId: "ord-1001", PaymentMethod: "card", IdempotencyKey: "stream"})
	if err != nil {
		t.Fatal(err)
	}
	bidi, err := c.TrackPayments(ctx)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := bidi.Send(&pb.GetPaymentRequest{PaymentId: p.PaymentId}); err != nil {
			t.Fatal(err)
		}
		got, err := bidi.Recv()
		if err != nil || got.GetPaymentId() != p.PaymentId {
			t.Fatalf("bidi: %v %v", got, err)
		}
	}
	if err := bidi.CloseSend(); err != nil {
		t.Fatal(err)
	}
	if _, err := bidi.Recv(); err != io.EOF {
		t.Fatal(err)
	}
}

func TestDeadlineAndCancellation(t *testing.T) {
	c := setup(t, 200*time.Millisecond)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	_, err := c.GetOrder(ctx, &pb.GetOrderRequest{OrderId: "ord-1001"})
	if status.Code(err) != codes.DeadlineExceeded {
		t.Fatal(err)
	}
	ctx2, cancel2 := context.WithCancel(context.Background())
	cancel2()
	_, err = c.GetOrder(ctx2, &pb.GetOrderRequest{OrderId: "ord-1001"})
	if status.Code(err) != codes.Canceled {
		t.Fatal(err)
	}
}
