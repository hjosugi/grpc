# 検証結果

検証日: 2026-09-06。ローカルLinux環境で実行しました。

## 実行環境

| 項目 | 実測値 |
| --- | --- |
| Go | 1.27.1 |
| Java | OpenJDK 17.0.20 |
| Maven | 3.9.16 |
| Node.js | 24.19.0 |
| Protobuf compiler | 35.1 |
| Spring Boot | 4.1.1 |
| NestJS | 12.0.1 |

## 実行した検証

| 検証 | 結果 |
| --- | --- |
| Go生成・ビルド | 成功 |
| `go test -race ./...` | 4テスト関数が成功、race未検出 |
| Maven `test` | Spring Boot gRPC統合テスト4件が成功 |
| Maven `package` | 実行可能JARの生成成功 |
| TypeScript生成・コンパイル | 成功 |
| Nest testing module + TCP通信 | 共通契約テスト11件が成功 |
| Go実サーバーに対する共通契約テスト | 11件成功 |
| Java実サーバーに対する共通契約テスト | 11件成功 |
| TypeScript実サーバーに対する共通契約テスト | 11件成功 |

Javaの単体統合テストはin-process transport、Goはbufconnを使います。
言語間の契約テストは別プロセスのサーバーにTCPで接続し、実際のProtobufとHTTP/2を通します。

## クライアントとサーバーの9通り

| Client / Server | Go | Java | TypeScript |
| --- | --- | --- | --- |
| Go | PASS | PASS | PASS |
| Java / Spring Boot | PASS | PASS | PASS |
| TypeScript / NestJS | PASS | PASS | PASS |

各組み合わせでUnary、server streaming、client streaming、bidi、同一keyの再送を実行しました。
決済額9,800円、注文集計2件・16,800円、`DEMO_OK` を確認しました。
bidiは返信を受けてから次のリクエストを送るため、送信終了まで返信をbufferしてしまう実装では成功しません。

## 契約テストの確認範囲

- 共通fixtureの3件と整数金額。
- 必須値、不正key、不正支払方法、不明な注文ID。
- 再送で同じ決済を返すこと。
- 同じkeyで異なるpayloadを送った場合の拒否。
- 支払済み注文への新しいkeyによる決済の拒否。
- 32件の同時再送。
- 模擬決済拒否の後に正常決済できること。
- 一覧の順序、フィルタ、空の結果。
- 空の集計stream、重複IDの集計、未知IDのエラー。
- client streamの1,001件目の拒否。
- 双方向streamの順序、送信終了前の返信、空stream、不明な決済ID。
- 明示deadlineとcancelのstatus。
- NestのObservable入力streamが、設定した期限で終了すること。

期限切れ時には、stream resetがクライアントtimerと競合して `CANCELLED` が先に届く場合があります。
未完了streamの期限テストは `DEADLINE_EXCEEDED` または `CANCELLED` と経過時間の両方を検証します。
明示Unary deadlineのテストは `DEADLINE_EXCEEDED` を検証します。

## この結果に含めないもの

- GitHub Actions上での実行結果。公開後にCIを確認する必要があります。
- Windows/macOSでの実行、JDK 21の実行結果。CIはJDK 21を指定しています。
- TLS/mTLS、認証、認可、永続DB、実決済、負荷試験、複数レプリカの整合性。
- 長時間・大量streamのbackpressureや再開処理。

再実行はREADMEの `setup` → `build` → `test` → `interop` を使用します。
`interop` のログと機械可読な結果は `.run/` に出力されます。
