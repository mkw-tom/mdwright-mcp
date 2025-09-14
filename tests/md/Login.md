suite: Login

case: 正常ログイン
- /login に移動
- メールアドレス に user@example.com を入力
- パスワード に pass を入力
- ログイン をクリック
- ダッシュボード が見える

case: パスワード誤りで失敗
- /login に移動
- メールアドレス に user@example.com を入力
- パスワード に wrongpass を入力
- ログイン をクリック
- メールアドレスかパスワードが違います が見える