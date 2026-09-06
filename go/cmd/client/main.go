package main

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"time"

	pb "github.com/hjosugi/grpc/go/gen/shop/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

func show(label string, m proto.Message) {
	b, err := protojson.Marshal(m)
	if err != nil {
		log.Fatal(err)
	}
	fmt.Printf("%s %s\n", label, b)
}
func check(err error) {
	if err != nil {
		log.Fatal(err)
	}
}

func main() {
	target := os.Getenv("GRPC_TARGET")
	if target == "" {
		target = "localhost:50051"
	}
	conn, err := grpc.NewClient(target, grpc.WithTransportCredentials(insecure.NewCredentials()))
	check(err)
	defer conn.Close()
	client := pb.NewShopServiceClient(conn)
	// One deadline bounds this short demo. Services should set a per-operation budget.
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	order, err := client.GetOrder(ctx, &pb.GetOrderRequest{OrderId: "ord-1001"})
	check(err)
	show("order", order)
	request := &pb.PayOrderRequest{OrderId: "ord-1001", PaymentMethod: "card", IdempotencyKey: "demo-pay-1001"}
	payment, err := client.PayOrder(ctx, request)
	check(err)
	show("payment", payment)
	replay, err := client.PayOrder(ctx, request)
	check(err)
	if !proto.Equal(payment, replay) {
		log.Fatal("idempotency failed")
	}
	listed, err := client.ListOrders(ctx, &pb.ListOrdersRequest{CustomerId: "customer-001"})
	check(err)
	for {
		o, err := listed.Recv()
		if err == io.EOF {
			break
		}
		check(err)
		show("listed", o)
	}
	summary, err := client.SummarizeOrders(ctx)
	check(err)
	check(summary.Send(&pb.GetOrderRequest{OrderId: "ord-1001"}))
	check(summary.Send(&pb.GetOrderRequest{OrderId: "ord-1002"}))
	total, err := summary.CloseAndRecv()
	check(err)
	show("summary", total)
	tracking, err := client.TrackPayments(ctx)
	check(err)
	// Each response arrives before the client half-closes the stream.
	for i := 0; i < 2; i++ {
		check(tracking.Send(&pb.GetPaymentRequest{PaymentId: payment.PaymentId}))
		p, err := tracking.Recv()
		check(err)
		show("tracked", p)
	}
	check(tracking.CloseSend())
	if _, err := tracking.Recv(); err != io.EOF {
		log.Fatalf("expected stream end, got %v", err)
	}
	if total.OrderCount != 2 || total.TotalYen != 16800 || payment.AmountYen != 9800 {
		log.Fatal("unexpected demo result")
	}
	fmt.Println("DEMO_OK")
}
