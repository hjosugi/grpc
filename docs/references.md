# 公式参照とバージョン確認

確認日: 2026-09-06。Webページの表示版と公開レジストリの安定版を照合しました。
`latest` を依存関係の指定には使わず、検証した版を固定しています。

| 項目 | 確認先 |
| --- | --- |
| Go gRPCの生成・server/client | [gRPC-Go quick start](https://grpc.io/docs/languages/go/quickstart/)、[Go basics](https://grpc.io/docs/languages/go/basics/) |
| gRPC-Go公開版 | [module metadata](https://proxy.golang.org/google.golang.org/grpc/@v/v1.83.2.info) |
| Go toolchain | [Go downloads](https://go.dev/dl/) |
| Go Protobuf runtime | [protobuf-go](https://github.com/protocolbuffers/protobuf-go) |
| Spring公式gRPC対応 | [Spring Boot gRPC reference](https://docs.spring.io/spring-boot/reference/io/grpc.html) |
| Spring Boot固定版のBOM | [4.1.1 dependency POM](https://repo.maven.apache.org/maven2/org/springframework/boot/spring-boot-dependencies/4.1.1/spring-boot-dependencies-4.1.1.pom) |
| SpringのgRPC抽象化 | [Spring gRPC](https://spring.io/projects/spring-grpc) |
| Java Protobuf生成 | [protobuf-maven-plugin](https://ascopes.github.io/protobuf-maven-plugin/) |
| Maven Wrapper | [Apache Maven Wrapper](https://maven.apache.org/wrapper/) |
| Nest gRPC | [NestJS gRPC](https://docs.nestjs.com/microservices/grpc) |
| Nest 12 | [NestJS v12.0.0 release](https://github.com/nestjs/nest/releases/tag/v12.0.0)、[12.0.1 package metadata](https://registry.npmjs.org/@nestjs/core/12.0.1) |
| Node gRPC runtime | [grpc-node](https://github.com/grpc/grpc-node)、[1.14.4 package metadata](https://registry.npmjs.org/@grpc/grpc-js/1.14.4) |
| TypeScript型生成 | [proto-loader](https://github.com/grpc/grpc-node/tree/master/packages/proto-loader) |
| Node.js | [Node.js releases](https://nodejs.org/en/about/previous-releases) |
| protoc | [Protocol Buffer Compiler Installation](https://protobuf.dev/installation/) |
| wire format | [Protobuf encoding](https://protobuf.dev/programming-guides/encoding/) |
| schema変更 | [Proto3 guide](https://protobuf.dev/programming-guides/proto3/) |
| deadline | [gRPC deadlines](https://grpc.io/docs/guides/deadlines/) |
| cancellation | [gRPC cancellation](https://grpc.io/docs/guides/cancellation/) |
| status codes | [gRPC status codes](https://grpc.io/docs/guides/status-codes/) |
| CLIによる動作確認 | [grpcurl](https://github.com/fullstorydev/grpcurl) |
| GitHub公開 | [gh repo create](https://cli.github.com/manual/gh_repo_create) |

## 固定版の詳細

- Go: 1.27.1、gRPC-Go: 1.83.2、Protobuf Go: 1.36.12、protoc-gen-go-grpc: 1.6.2。
- Java: Spring Boot 4.1.1。gRPC Java 1.83.1、Protobuf Java 4.35.1はBoot BOMで管理。
- Java生成plugin: Boot parentが管理する `io.github.ascopes:protobuf-maven-plugin` 5.1.8。
- TypeScript: NestJS 12.0.1、gRPC-JS 1.14.4、proto-loader 0.8.1、RxJS 7.8.2、TypeScript 5.9.3。
- Maven: Wrapper 3.3.4、Maven distribution 3.9.16。

TypeScript 5.9.3はこの教材の固定コンパイラです。「すべてのツールが常に最新版」という意味ではありません。
`go.sum` と `package-lock.json` を含めています。JavaはBoot parent/BOMで依存関係をそろえます。
