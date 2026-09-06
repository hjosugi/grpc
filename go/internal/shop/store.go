package shop

import (
	"os"
	"regexp"
	"sync"

	pb "github.com/hjosugi/grpc/go/gen/shop/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
)

var keyPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

type receipt struct {
	orderID, method string
	payment         *pb.Payment
}

// Store is process-local. The mutex makes check-and-insert atomic.
type Store struct {
	orders   []*pb.Order
	mu       sync.Mutex
	keys     map[string]receipt
	paid     map[string]bool
	payments map[string]*pb.Payment
}

func Load(path string) (*Store, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var fixture pb.OrdersFixture
	if err := protojson.Unmarshal(data, &fixture); err != nil {
		return nil, err
	}
	seen := map[string]bool{}
	for _, o := range fixture.Orders {
		if o.OrderId == "" || seen[o.OrderId] || o.Quantity == 0 || o.Quantity > 10000 || o.UnitPriceYen <= 0 || o.UnitPriceYen > 100000000 || o.TotalYen != int64(o.Quantity)*o.UnitPriceYen {
			return nil, status.Error(codes.InvalidArgument, "invalid order fixture")
		}
		seen[o.OrderId] = true
	}
	return &Store{orders: fixture.Orders, keys: map[string]receipt{}, paid: map[string]bool{}, payments: map[string]*pb.Payment{}}, nil
}

func (s *Store) Get(id string) (*pb.Order, error) {
	if id == "" {
		return nil, status.Error(codes.InvalidArgument, "order_id is required")
	}
	for _, o := range s.orders {
		if o.OrderId == id {
			return proto.Clone(o).(*pb.Order), nil
		}
	}
	return nil, status.Error(codes.NotFound, "order not found")
}

func (s *Store) List(customer string) []*pb.Order {
	result := []*pb.Order{}
	for _, o := range s.orders {
		if customer == "" || o.CustomerId == customer {
			result = append(result, proto.Clone(o).(*pb.Order))
		}
	}
	return result
}

func (s *Store) Pay(r *pb.PayOrderRequest) (*pb.Payment, error) {
	if !keyPattern.MatchString(r.IdempotencyKey) {
		return nil, status.Error(codes.InvalidArgument, "idempotency_key must match [A-Za-z0-9_-]{1,64}")
	}
	if r.PaymentMethod != "card" && r.PaymentMethod != "bank_transfer" && r.PaymentMethod != "declined" {
		return nil, status.Error(codes.InvalidArgument, "unsupported payment_method")
	}
	o, err := s.Get(r.OrderId)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if old, ok := s.keys[r.IdempotencyKey]; ok {
		if old.orderID != r.OrderId || old.method != r.PaymentMethod {
			return nil, status.Error(codes.AlreadyExists, "idempotency_key was used for another request")
		}
		return proto.Clone(old.payment).(*pb.Payment), nil
	}
	if s.paid[r.OrderId] {
		return nil, status.Error(codes.FailedPrecondition, "order is already paid")
	}
	if r.PaymentMethod == "declined" {
		return nil, status.Error(codes.FailedPrecondition, "demo payment declined")
	}
	if len(s.keys) >= 10000 {
		return nil, status.Error(codes.ResourceExhausted, "demo receipt limit reached")
	}
	p := &pb.Payment{PaymentId: "pay-" + r.IdempotencyKey, OrderId: r.OrderId, AmountYen: o.TotalYen, Status: pb.PaymentStatus_PAYMENT_STATUS_PAID}
	s.keys[r.IdempotencyKey] = receipt{r.OrderId, r.PaymentMethod, p}
	s.paid[r.OrderId] = true
	s.payments[p.PaymentId] = p
	return proto.Clone(p).(*pb.Payment), nil
}

func (s *Store) Payment(id string) (*pb.Payment, error) {
	if id == "" {
		return nil, status.Error(codes.InvalidArgument, "payment_id is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	p, ok := s.payments[id]
	if !ok {
		return nil, status.Error(codes.NotFound, "payment not found")
	}
	return proto.Clone(p).(*pb.Payment), nil
}
