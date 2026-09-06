# TypeScript: NestJS

## 読む順番

1. [config.ts](../typescript/src/config.ts): protoとloader設定。
2. [app.module.ts](../typescript/src/app.module.ts): StoreをDIするModule。
3. [shop.controller.ts](../typescript/src/shop.controller.ts): RPCの入り口。
4. [shop.store.ts](../typescript/src/shop.store.ts): 同じ決済ルール。
5. [shop.client.ts](../typescript/src/shop.client.ts): `ClientsModule` とObservableのclient。
6. [client.ts](../typescript/src/client.ts): 4種類のRPCを順番に実行。

## Nestが担当すること

`NestFactory.createMicroservice()` と `Transport.GRPC` でgRPC serverを起動します。
`@GrpcMethod` がUnary / server streaming、`@GrpcStreamMethod` が入力streamのhandlerを登録します。
`ShopStore` はfactory providerで構築し、constructor injectionでcontrollerに渡します。
gRPC-JSだけでserverを手組みする実装ではなく、NestのDIとtransportを使っています。

## Protobuf型の生成

```bash
cd typescript
npm ci
npm run build
```

`@grpc/proto-loader` の公式 `proto-loader-gen-types` がTypeScript型を生成します。
実行時は同じprotoをloaderで読み込みます。型の生成だけと実行時の読込の設定は一致させます。

| 設定 | 理由 |
| --- | --- |
| `keepCase: true` | `order_id` などの名前をそのまま使う |
| `longs: String` | `int64` をJavaScriptの `number` に変換しない |
| `enums: String` | `PAYMENT_STATUS_PAID` と表示して分かりやすくする |
| `defaults: true` | 省略フィールドも既定値で扱う |

`Order__Output` はデコード後の型です。入力用の `Order` は省略可能なフィールドを含みます。
`ShopRpc` は生成されたmessage型を使い、Nestが公開するObservableメソッドの形を定義します。
NestJS 12に合わせてESMを使っています。手書きコードの相対importには `.js` 拡張子を付けます。

## Observableを読む

- `firstValueFrom()` はUnaryの結果を1件待つ。
- `toArray()` は短いデモのserver streamを最後まで集める。
- `reduce()` は入力streamを件数と合計へ集約する。
- `map()` はbidiのリクエスト1件を返信1件へ変換する。
- `ReplaySubject` はデモのbidiで入力を送り、`complete()` で送信を終了する。

本番の無制限streamを `toArray()` で全件保持してはいけません。
また、RxJSを使っただけで、producerとconsumerの速度差が自動的に解決するわけではありません。
本教材は入力1,000件までとし、大量データのflow controlは拡張演習にしています。

## deadlineの注意点

NestJS 12.0.1のObservable入力streamのadapterは、Unaryと同じ形の第3引数 `CallOptions` を転送しません。
そこでclientのgRPC service configに5秒のtimeoutを設定しています。
Unary / server streamingでは、さらに呼び出し単位のdeadlineも渡せます。

テストでは送信を終了しないstreamを作り、設定した期限で終了することを実測します。
Goとの通信では、サーバーの期限切れによるstream resetとクライアントのtimerが競合し、`CANCELLED` が先に見える場合も確認しました。
このテストは終了コードだけでなく、設定した1秒より早く終了しないこと、4秒未満で終了することも確認します。
明示的なUnaryのdeadlineテストは `DEADLINE_EXCEEDED` を検証します。

## Nodeならrace conditionがない？

この `pay()` は同期処理で、key確認と保存の間に `await` がありません。
そのため1つのNodeプロセス内ではその区間へ別のリクエストが割り込みません。
ただし、DBアクセスを `await` したり、複数プロセスを起動したりすると事情が変わります。
本番ではDBのunique constraintとtransactionなどが必要です。

## 実行

```bash
cd typescript
npm test
npm start
```

別ターミナル:

```bash
cd typescript
GRPC_TARGET=localhost:50052 npm run client
```

`npm test` はNestのtesting moduleからserverを起動し、実際のTCPで11項目を検証します。
`GRPC_TARGET` を指定した `npm run contract` は、その接続先に同じ契約テストを実行します。
契約テストは決済状態を変更するため、fixtureを使う検証用serverへ実行してください。
