# 手を動かす演習

## 1. 言語を入れ替える

```bash
python3 scripts/dev.py server java
```

別ターミナルで:

```bash
python3 scripts/dev.py client go --target localhost:50052
python3 scripts/dev.py client typescript --target localhost:50052
```

どちらも同じ注文と決済を返します。呼び出し先がJavaであることを、clientのprotobuf契約は意識しません。

## 2. grpcurlでUnaryとserver streaming

[grpcurl](https://github.com/fullstorydev/grpcurl)をインストールし、リポジトリrootで実行します。
この手順はprotoを明示するため、reflectionがないTypeScriptサーバーでも動かせます。

```bash
grpcurl -plaintext -import-path proto -proto shop/v1/shop.proto \
  -d @ localhost:50051 shop.v1.ShopService/GetOrder < fixtures/requests/get-order.json

grpcurl -plaintext -import-path proto -proto shop/v1/shop.proto \
  -d @ localhost:50051 shop.v1.ShopService/PayOrder < fixtures/requests/pay-order.json

grpcurl -plaintext -import-path proto -proto shop/v1/shop.proto \
  -d @ localhost:50051 shop.v1.ShopService/ListOrders < fixtures/requests/list-orders.json
```

期待値は注文9,800円、決済ID `pay-demo-pay-1001`、一覧2件です。
支払いコマンドをもう一度実行しても、決済IDは同じです。

## 3. client streamingとbidi

```bash
grpcurl -plaintext -import-path proto -proto shop/v1/shop.proto \
  -d @ localhost:50051 shop.v1.ShopService/SummarizeOrders < fixtures/requests/summarize-orders.jsonl

grpcurl -plaintext -import-path proto -proto shop/v1/shop.proto \
  -d @ localhost:50051 shop.v1.ShopService/TrackPayments < fixtures/requests/track-payments.jsonl
```

集計は2件・16,800円。決済照会は先に演習2の決済を作ってから実行し、同じ決済が2回返ります。
双方向に交互送信する例は各言語のclientを読んでください。

## 4. 失敗を確認する

```bash
grpcurl -plaintext -import-path proto -proto shop/v1/shop.proto \
  -d '{}' localhost:50051 shop.v1.ShopService/GetOrder

grpcurl -plaintext -import-path proto -proto shop/v1/shop.proto \
  -d '{"order_id":"missing"}' localhost:50051 shop.v1.ShopService/GetOrder

grpcurl -plaintext -import-path proto -proto shop/v1/shop.proto \
  -d '{"order_id":"ord-1002","payment_method":"card","idempotency_key":"demo-pay-1001"}' \
  localhost:50051 shop.v1.ShopService/PayOrder
```

順に `INVALID_ARGUMENT`、`NOT_FOUND`、`ALREADY_EXISTS` です。
3つ目は先に `ord-1001` を `demo-pay-1001` で支払っておきます。

## 5. deadlineを実測する

Goサーバーを止めて、遅延付きで起動します。

```bash
DEMO_DELAY_MS=500 python3 scripts/dev.py server go
```

別ターミナル:

```bash
grpcurl -plaintext -max-time 0.1 -import-path proto -proto shop/v1/shop.proto \
  -d '{"order_id":"ord-1001"}' localhost:50051 shop.v1.ShopService/GetOrder
```

応答は500ms後なのに、clientは100msで待機を終了します。
サーバー側のdelay処理もcancelを確認します。支払い処理の副作用を取り消す例ではありません。

## 6. 実装を変更する練習

| 演習 | 変更する場所 | 確認方法 |
| --- | --- | --- |
| fixtureに注文を1件追加 | `fixtures/orders.json` | 3言語の一覧に同じ注文が現れる |
| `Order` に配送先フィールド追加 | `shop.proto` の新しいfield number | 再生成して3言語で取得 |
| 失敗した決済も記録する | 3つのStore | 同じkey・同じ失敗を再送できる |
| stateを永続化する | Storeと起動設定 | 再起動後にも同じkeyで同じ決済が返る |
| 注文サービスと決済サービスを分離 | protoと新しいclient | deadlineの予算を下流へ渡す |

## よくあるつまずき

| 症状 | 確認 |
| --- | --- |
| `UNAVAILABLE` | serverを起動したか、portが合うか |
| `UNIMPLEMENTED` | `shop.v1.ShopService` とmethod名、生成前の古い成果物 |
| Goで生成packageが見つからない | `setup` と `build` をrootで実行したか |
| Javaでprotoクラスが見つからない | `./mvnw compile` で生成したか |
| Nodeでprotoを読めない | `typescript/` から実行するか、絶対パスの `PROTO_PATH` |
| 再送で `FAILED_PRECONDITION` | 同じ注文を別のkeyで支払っていないか |
| 集計の応答が来ない | 入力streamを `CloseAndRecv` / `onCompleted` / `complete` したか |
| portが使用中 | 既存serverを終了するか、環境変数で変更 |

各サーバーは独立したメモリを持ちます。サーバーを変えると決済が見つからないことがあります。
