package shop

import (
	"context"
	"io"
	"time"

	pb "github.com/hjosugi/grpc/go/gen/shop/v1"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type Server struct {
	pb.UnimplementedShopServiceServer
	Store     *Store
	ReadDelay time.Duration
}

func (s *Server) GetOrder(ctx context.Context, r *pb.GetOrderRequest) (*pb.Order, error) {
	if s.ReadDelay > 0 {
		timer := time.NewTimer(s.ReadDelay)
		defer timer.Stop()
		select {
		case <-ctx.Done():
			return nil, status.FromContextError(ctx.Err()).Err()
		case <-timer.C:
		}
	}
	return s.Store.Get(r.OrderId)
}

func (s *Server) PayOrder(ctx context.Context, r *pb.PayOrderRequest) (*pb.Payment, error) {
	if err := ctx.Err(); err != nil {
		return nil, status.FromContextError(err).Err()
	}
	return s.Store.Pay(r)
}

func (s *Server) ListOrders(r *pb.ListOrdersRequest, stream grpc.ServerStreamingServer[pb.Order]) error {
	for _, o := range s.Store.List(r.CustomerId) {
		if err := stream.Send(o); err != nil {
			return err
		}
	}
	return nil
}

func (s *Server) SummarizeOrders(stream grpc.ClientStreamingServer[pb.GetOrderRequest, pb.OrderSummary]) error {
	summary := &pb.OrderSummary{}
	for {
		r, err := stream.Recv()
		if err == io.EOF {
			return stream.SendAndClose(summary)
		}
		if err != nil {
			return err
		}
		if summary.OrderCount == 1000 {
			return status.Error(codes.ResourceExhausted, "stream is limited to 1000 items")
		}
		o, err := s.Store.Get(r.OrderId)
		if err != nil {
			return err
		}
		summary.OrderCount++
		summary.TotalYen += o.TotalYen
	}
}

func (s *Server) TrackPayments(stream grpc.BidiStreamingServer[pb.GetPaymentRequest, pb.Payment]) error {
	count := 0
	for {
		r, err := stream.Recv()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		if count == 1000 {
			return status.Error(codes.ResourceExhausted, "stream is limited to 1000 items")
		}
		p, err := s.Store.Payment(r.PaymentId)
		if err != nil {
			return err
		}
		if err := stream.Send(p); err != nil {
			return err
		}
		count++
	}
}
