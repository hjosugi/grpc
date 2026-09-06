package main

import (
	"context"
	"log"
	"net"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	pb "github.com/hjosugi/grpc/go/gen/shop/v1"
	"github.com/hjosugi/grpc/go/internal/shop"
	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	healthpb "google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"
)

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func main() {
	store, err := shop.Load(env("FIXTURES_PATH", "../fixtures/orders.json"))
	if err != nil {
		log.Fatal(err)
	}
	delay, err := strconv.Atoi(env("DEMO_DELAY_MS", "0"))
	if err != nil || delay < 0 || delay > 5000 {
		log.Fatal("DEMO_DELAY_MS must be 0..5000")
	}
	listener, err := net.Listen("tcp", env("GRPC_ADDR", "127.0.0.1:50051"))
	if err != nil {
		log.Fatal(err)
	}
	server := grpc.NewServer(grpc.MaxRecvMsgSize(1024*1024), grpc.MaxConcurrentStreams(100))
	pb.RegisterShopServiceServer(server, &shop.Server{Store: store, ReadDelay: time.Duration(delay) * time.Millisecond})
	h := health.NewServer()
	h.SetServingStatus("", healthpb.HealthCheckResponse_SERVING)
	h.SetServingStatus("shop.v1.ShopService", healthpb.HealthCheckResponse_SERVING)
	healthpb.RegisterHealthServer(server, h)
	reflection.Register(server)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		h.Shutdown()
		time.AfterFunc(5*time.Second, server.Stop)
		server.GracefulStop()
	}()
	log.Printf("Go gRPC server: %s", listener.Addr())
	if err := server.Serve(listener); err != nil {
		log.Fatal(err)
	}
}
