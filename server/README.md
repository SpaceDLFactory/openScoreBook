# 공유 서버

경기 하나를 링크로 공유하는 서버다. 설계는 [docs/design/sharing.md](../docs/design/sharing.md)에 있다. 호스팅 플랫폼은 아직 정하지 않았고, 지금은 로컬에서만 돌린다.

- `src/app.ts`: 서버 본체. [Hono](https://hono.dev)로 짰고 웹 표준 Request/Response만 쓰므로, 저장소(`Store`), PNG 변환, 클라이언트 식별만 넣어 주면 다른 호스트에서도 돈다.
- `src/store.ts`: 저장소 인터페이스와 메모리·파일 저장소.
- `src/node.ts`: 로컬 실행. 공유는 `data/`에 파일로 쌓이고, 스코어 카드는 resvg와 Noto Sans KR로 그린다.

받은 기록은 앱과 같은 코드(`app/src/lib/share.ts`)로 검사하고 엔진으로 다시 계산해서, 맞는 것만 저장한다.

## 로컬에서 돌리기

```sh
cd server
npm install
npm run fonts   # Noto Sans KR (SIL OFL)을 fonts/에 받는다. 저장소에는 넣지 않는다
APP_URL=http://localhost:5173/ npm run dev   # http://localhost:8787
```

앱은 공유 서버 주소를 넣어 띄운다. 이 값이 없는 빌드(GitHub Pages 배포본 포함)에는 링크 공유 버튼이 나오지 않는다.

```sh
cd app
VITE_SHARE_API=http://localhost:8787 npm run dev
```

| 환경 변수 | 기본값 | 뜻 |
| --- | --- | --- |
| `PORT` | `8787` | 서버 포트 |
| `PUBLIC_URL` | `http://localhost:PORT` | 링크와 미리보기 태그에 쓰는 서버 주소 |
| `APP_URL` | `http://localhost:5173/` | 공유 링크를 연 사람을 보낼 앱 주소 |
| `ORIGINS` | `APP_URL`의 origin | API를 브라우저에서 부를 수 있는 origin (쉼표로 여럿) |

## API

| 경로 | 하는 일 |
| --- | --- |
| `POST /api/share` | 경기를 받아 검사하고 저장한다. 응답 `{ id, url, deleteKey }` |
| `GET /api/share/:id` | 공유된 경기 |
| `DELETE /api/share/:id` | `X-Delete-Key` 헤더가 맞으면 지운다 |
| `GET /g/:id` | 그 경기의 미리보기 태그가 든 페이지. 사람은 앱(`APP_URL#share=:id`)으로 넘어간다 |
| `GET /g/:id/card.png` | 1200×630 스코어 카드 |

## 테스트

```sh
npm test       # vitest
npm run check  # tsc
```
