# ひかり野線 運転士

ブラウザで遊ぶ電車の運転シミュレーター（three.js）。架空の路線「ひかり野線」を、海辺の潮見台から山あいの山ノ口まで 4 駅 5.8 km 運転します。

- 時刻表・ドアの開け閉め・発車メロディ・出発信号・ATS・制限速度・停止位置・喚呼・車内放送・警笛・踏切・すれ違う列車
- カーブと勾配のある複線、海岸・町・田んぼ・川のトラス橋・トンネル・山の森
- 画面の後処理：物の陰の暗がり（GTAO）、光のにじみ、色の調子、速さのぼかし、遠くまでの細かい影（CSM）

## 操作
Z 加速 / X ブレーキ / N 惰行 / Space 非常 / O ドア / K 喚呼 / A 放送 / H 警笛 / C 視点 / W ワイパー / M 消音

## 開発
```
npm install
npm run dev
npm test
npm run build
```

## 素材
木の葉・草・低木・地面・岩などのテクスチャと 3D モデルは [Poly Haven](https://polyhaven.com/)（CC0）。

## 公開
Cloudflare の Workers Builds でこのリポジトリをつなぐと、main への push ごとに公開されます（ビルドコマンド `npm run build`、配信は `wrangler.jsonc` の `dist`）。
