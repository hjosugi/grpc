# Java: Spring Bootの公式gRPC対応

## 読む順番

1. [pom.xml](../java/pom.xml): 公式server/client starterとコード生成plugin。
2. [application.properties](../java/src/main/resources/application.properties): serverのport、clientのtarget、fixture。
3. [ShopGrpcService.java](../java/src/main/java/dev/hjosugi/grpc/ShopGrpcService.java): `@GrpcService` と `StreamObserver`。
4. [ShopStore.java](../java/src/main/java/dev/hjosugi/grpc/ShopStore.java): `@Service` とconstructor injection。
5. [ClientConfiguration.java](../java/src/main/java/dev/hjosugi/grpc/ClientConfiguration.java): DIされるblocking/async stub。

## Spring Bootが担当すること

`@GrpcService` のbeanを検出し、gRPC serverへ登録します。
`@ImportGrpcClients` が、指定したtargetへ接続するstubをbeanとして作成します。
Springのapplication contextが、service、store、channelのライフサイクルを管理します。

公式対応はSpring Boot 4.1で整理されています。教材の設定はこの版に合わせています。
`grpc.server.port` ではなく `spring.grpc.server.port` を使います。
client profileではserverを無効にし、デモ実行後にcontextを閉じてchannelを解放します。

## `StreamObserver`とは

| メソッド | 意味 |
| --- | --- |
| `onNext(value)` | 1件送る |
| `onCompleted()` | 正常に終了する |
| `onError(error)` | エラーで終了する |

Unaryでも、このobserverで1件返信します。
client streamingでは、戻り値のobserverがクライアントから届く入力を受け取ります。
引数のobserverはサーバーからクライアントへの出力です。
`onError` / `onCompleted` 後に送信を続けないよう、streamごとに `done` を管理しています。

## 同期と非同期

blocking stubは、結果が返るまでその呼び出し元threadを待機させます。
async stubはobserver経由で結果を受け取るため、client streamingやbidiにも使えます。
教材のclientは、非同期の結果を `CountDownLatch` と `BlockingQueue` で待ち、CLIの表示順を分かりやすくしています。
各待機には上限があり、無期限に待ちません。

`ShopStore.pay()` の `synchronized` はcheck-and-insert全体を保護します。
生成されたJavaのProtobuf messageはimmutableなので、保存済みmessageをそのまま再送できます。

## 実行とテスト

```bash
cd java
./mvnw test
./mvnw package
java -jar target/grpc-java-1.0.0.jar
```

別ターミナル:

```bash
cd java
GRPC_TARGET=localhost:50051 java -jar target/grpc-java-1.0.0.jar --spring.profiles.active=client
```

`ShopGrpcTest` は `@SpringBootTest` と `@AutoConfigureTestGrpcTransport` を使います。
Springのbean設定とgRPC呼び出しを通して検証しますが、このテストtransport自体はTCPを使いません。
別途 `scripts/interop.py` が実際のNetty serverを起動し、Protobuf / HTTP/2の言語間通信を検証します。

`DEMO_DELAY_MS` は期限切れの演習用です。Javaでは小刻みな待機中にcancelを確認します。
本番の長い外部I/Oをこのデモ待機に置き換える場合は、I/O先のtimeout/cancelも設計してください。
