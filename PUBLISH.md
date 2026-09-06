# hjosugi/grpcへ公開する

コードの公開先は `hjosugi/grpc`、公開範囲はpublicです。
このファイルにアクセストークンなどの認証情報は含めません。

## GitHubの画面で作成してから追加する

[新規リポジトリ画面](https://github.com/new)で、Ownerを `hjosugi`、名前を `grpc`、visibilityをPublicにして作成します。
ローカルの内容を初回pushする場合は、README、.gitignore、licenseをGitHub側で追加しない空の状態にしてください。

ZIPから展開した場合は、Gitの履歴を含めていないため、展開した `grpc` ディレクトリで初期化します。

```bash
git init -b main
git add .
git commit -m "Add Go, Spring Boot, and NestJS gRPC learning examples"
git remote add origin https://github.com/hjosugi/grpc.git
git push -u origin main
```

すでにローカルGitリポジトリになっている場合は、初期化や初回commitの重複を避けてください。
pushはGitHubの認証が設定された環境で実行します。

## GitHub CLIで作成とpushをまとめる

GitHub CLIがインストールされ、`gh auth status` で `hjosugi` として認証されている場合:

```bash
gh repo create hjosugi/grpc --public --source=. --remote=origin --push \
  --description "Learn gRPC with Go, Spring Boot, and NestJS: shared fixtures, streaming, tests, and cross-language clients"
```

このコマンドはローカルGitにcommitがある状態で使います。
同名リポジトリがすでにある場合は新規作成せず、既存の内容を確認して通常のpushを使ってください。

## 公開後

GitHub ActionsのCIが、依存取得、3言語のテスト、ビルド、9通りの相互通信を実行します。
ローカルで成功した結果は [docs/verification.md](docs/verification.md) に記載しています。
GitHub Actionsの実行結果は、実際に公開してCIが動いた後に確認してください。
