# 사이 NestJS API

Next.js 프론트엔드와 분리된 NestJS 서버입니다. Node.js 24 이상, TypeScript 6, pnpm을 사용합니다. TypeScript의 `NodeNext` 모듈 해석으로 Node.js 실행 환경을 검사합니다. 운영 DB와 테스트 DB는 서버 PC의 서로 다른 폴더에 저장합니다.

## NestJS 코드 구조

- `src/app.module.ts`: 기능 모듈만 조합하는 루트 모듈
- `src/database/`: SQLite 연결·마이그레이션 서비스와 이를 내보내는 `DatabaseModule`
- `src/auth/`: 가입·운영자 로그인 컨트롤러, 인증 서비스, 회원·운영자 가드, `AuthModule`
- `src/community/`: 말씀·사진·댓글·기도·신고 컨트롤러와 서비스, `CommunityModule`
- `src/daily-word/`: 날짜별 말씀·질문 조회, 한국 날짜 검증, `DailyWordModule`
- `src/admin/`: 승인·신고 검토·구성원·설정·공지 컨트롤러와 서비스, `AdminModule`
- `src/news/`: 교회 소식 목록·상세·관리·표지 사진 API와 `NewsModule` (기존 공지사항과 별도)
- `src/push/`: 회원 푸시 구독·운영자 발송 설정·한국 시간 예약 발송, `PushModule`

각 기능 모듈은 필요한 모듈을 `imports`하고, 다른 기능에서 사용하는 provider만 `exports`합니다. 컨트롤러는 경로와 HTTP 입력을 서비스에 전달하고, 서비스가 검증과 DB 작업을 맡습니다.

## 로컬 실행

1. `pnpm install`
2. 운영은 `.env.example` → `.env`, 테스트는 `.env.test.example` → `.env.test`를 사용합니다. 이 PC에는 두 로컬 설정이 생성되어 있습니다. 두 파일의 운영자 비밀번호는 별도로 관리하고 저장소에 넣지 마세요. 주 운영자 비밀번호 최소 길이는 12자입니다.
3. 개발·검증은 `pnpm build` 후 테스트 API `pnpm start:test`(4100번)를 실행합니다.
4. 프론트엔드 디렉터리에서 `pnpm dev`(3001번)를 실행합니다.
5. `http://127.0.0.1:3001`로 접속합니다. 운영 API `pnpm start`(4000번)와 운영 웹 `pnpm start`(3000번)는 사용자가 명시적으로 요청한 경우에만 실행합니다.

이 PC의 PowerShell에서 `npm` 명령은 손상된 전역 `npm.ps1`을 선택해 실패할 수 있습니다. `npm.cmd run start:test` 또는 `pnpm start:test`를 사용하세요. 테스트 API는 4100번 포트에 한 번만 실행합니다.

| 모드 | 설정 파일 | API 포트 | DB | 사진 |
| --- | --- | --- | --- | --- |
| 운영 | `.env` | 4000 | `E:\실 서버\sai.sqlite` | `E:\실 서버\uploads` |
| 테스트 | `.env.test` | 4100 | `E:\테스트 서버\sai.sqlite` | `E:\테스트 서버\uploads` |

기존 `E:\sai.sqlite`는 SQLite 백업 기능으로 운영 폴더에 복사했습니다. 원본 `E:\sai.sqlite`와 `E:\sai-uploads`는 복구용으로 그대로 남겨 두었습니다. 운영 데이터가 테스트 DB로 자동 복제되지는 않습니다. 교회명은 현재 가입 화면의 `광주동산교회`를 임시로 적용했습니다. 실제 교회명이 다르면 각 설정 파일의 `CHURCH_NAME`을 바꾸고 해당 서버를 재시작하세요. SQLite WAL 모드에서는 각 DB 옆에 `-wal`·`-shm` 파일이 생길 수 있습니다.

2026-10-02 요청에 따라 운영 활성 DB를 초기화했습니다. 초기화 직전 DB와 이전 백업은 `E:\실 서버\reset-archive-20261002-234630`에 보관했으며, 현재 활성 운영 DB는 빈 회원·게시물 상태입니다. 이 보관 폴더는 운영 서버에서 사용하지 않습니다. 테스트 DB는 유지했습니다.

## API

기본 경로 `/api`. 프론트엔드는 같은 출처의 `/api`를 Next.js rewrite를 통해 사용합니다.

| 영역 | 주요 경로 | 권한 |
| --- | --- | --- |
| 가입·세션 | `POST /auth/signup`, `POST /auth/login`, `GET /auth/me`, `POST /auth/password`, `POST /auth/change-password`, `POST /auth/logout` | 회원 세션·전화번호/비밀번호 |
| 운영자 | `POST /auth/admin/login`, `GET /auth/admin/me`, `POST /auth/admin/logout` | 별도 운영자 세션 |
| 공동체 | `GET /community`, `/words`, `/photos`, `/prayers`, `/reports` 하위 경로 | 승인 회원 |
| 오늘의 말씀 | `GET /daily-word?date=YYYY-MM-DD` | 공개 읽기 |
| 운영 | `/admin/dashboard`, `/admin/approvals`, `/admin/members`, `/admin/reports` | 운영자 |
| 설정 | `/admin/settings`, `/admin/accounts`, `/admin/notices`, `/admin/daily-words` | 운영자; 계정 추가·삭제는 주 운영자만 |
| 교회 소식 | `GET /news`, `GET /news/:id`, `GET /news/:id/cover` | 승인 회원 |
| 교회 소식 관리 | `GET/POST /admin/news`, `GET/PATCH/DELETE /admin/news/:id`, `GET /admin/news/:id/cover` | 운영자 |
| 말씀 푸시 | `GET /push/config`, `POST /push/status`, `POST/DELETE /push/subscriptions` | 승인 회원 |
| 푸시 운영 설정 | `GET/PATCH /admin/push/settings` | 운영자 |

## 말씀 푸시 알림

VAPID 키 쌍을 한 번 생성해 실행 환경의 `VAPID_PUBLIC_KEY`·`VAPID_PRIVATE_KEY`에 각각 저장하고, `VAPID_SUBJECT`에는 연락 가능한 `mailto:` 주소 또는 HTTPS URL을 지정합니다. 개인키는 프론트엔드나 문서에 넣지 않습니다. 세 값이 없으면 푸시를 켤 수 없고 다른 기능은 계속 작동합니다.

승인 회원은 내 공간의 알림 설정에서 브라우저 권한을 허용하고 기기별 구독을 등록·해제합니다. 운영자는 운영 설정의 **말씀 알림**에서 매일 발송 여부와 `HH:mm` 시각을 정합니다. 기본값은 **꺼짐·08:00(한국 시간)**입니다. 서버는 설정 시각부터 10분 안에 실행 중일 때 해당 날짜의 말씀 알림을 구독 기기마다 한 번 전송합니다. 서버가 꺼져 이 시간을 놓치면 그날 알림은 보내지 않습니다. 회원 로그아웃·임시 비밀번호 재설정 시 해당 회원의 서버 구독을 해제합니다.

브라우저 푸시 구독은 HTTPS 출처에 묶입니다. QA Quick Tunnel 주소가 바뀌면 사용자는 새 주소의 PWA를 다시 설치하고 알림을 다시 허용해야 합니다. 정식 사용에는 고정 HTTPS 주소가 필요합니다. 아이폰은 iOS 16.4 이상에서 홈 화면에 추가한 PWA로 열어야 합니다.

교회 소식은 DB 스키마 v6의 `news` 테이블에 저장합니다. 제목 1–80자, 본문 1–5000자, 분류 `notice`·`gathering`·`story`, 상태 `draft`·`published`를 사용합니다. 목록은 배열이며 본문 앞 140자의 `excerpt`를 포함합니다. 회원은 게시 상태만 최신 게시순으로 조회하고, 운영자는 초안까지 최신 수정순으로 조회합니다. `GET /news?category=...`로 회원 목록을 분류할 수 있습니다. 생성·수정 요청은 `multipart/form-data`이며 선택 필드 `cover`에 JPEG/PNG/WebP 10MB 이하 이미지를 보낼 수 있습니다. 수정 시 새 파일 없이 `removeCover=true`를 보내면 표지를 제거합니다. 응답의 `coverUrl`은 접근 권한에 맞는 이미지 URL입니다. 삭제는 소프트 삭제이며 다시 조회·삭제하면 404입니다. 이미지 조회도 회원·운영자 권한과 게시·삭제 상태를 검사합니다. 기존 `/admin/notices`와 공동체 홈의 공지 프리뷰는 바꾸지 않았습니다.

날짜 기준은 `Asia/Seoul`의 `YYYY-MM-DD`입니다. `GET /daily-word`에서 날짜를 생략하면 오늘을 조회합니다. 직접 지정한 날짜가 없으면 2026-10-02를 시작점으로 하는 앱의 30일 말씀·질문 순환표를 날짜에 따라 선택합니다. 자정마다 날짜가 바뀌므로 별도 예약 작업이나 DB 쓰기가 필요 없습니다. 응답은 `{date, reference, verse, scriptureText, scriptureVersion, scriptureAttribution, question, readingUrl, source}`이며 `verse`는 앱의 묵상 문구, `scriptureText`는 실제 성경 구절입니다. 순환표의 구절은 『성경전서 개역한글판』(1961), 대한성서공회입니다. 본문 데이터는 [디지털 대조 자료](https://github.com/bluesaurel/Korean-Bible-1961-KRV)를 참고해 장·절별로 선택했으며, 해당 자료 자체는 공식 정본과 완전 일치를 보증하지 않습니다. 대한성서공회의 [개역한글판 이용 안내](https://www.bskorea.or.kr/bbs/board.php?bo_table=copyright_faq&wr_id=5)에 따라 역본·저작자를 표시하고 본문을 개작하지 않습니다. 기존 `readingUrl`은 대한성서공회 성경플랫폼의 별도 성경읽기 링크로 유지하며, 링크의 개역개정판 본문은 앱에 복제하지 않습니다.

`source`는 `plan` 또는 `custom`입니다. 운영자가 `PUT /admin/daily-words/:date`에 `{reference, verse, scriptureText, scriptureVersion, scriptureAttribution, question, readingUrl?}`을 보내 저장한 내용은 해당 날짜의 자동 순환표보다 우선합니다. `scriptureText`는 1–2000자, `scriptureVersion`은 1–50자, `scriptureAttribution`은 1–100자로 필수입니다. 운영자는 해당 역본의 사용 권한과 원문 정확성을 확인해야 합니다. `GET /admin/daily-words`는 직접 지정한 날짜만 반환합니다. `readingUrl`은 대한성서공회 성경플랫폼(`https://bible.bskorea.or.kr/`) 주소 또는 `null`만 허용하며, 비워 두면 알려진 말씀 위치의 장별 공식 주소를 자동 생성합니다. DB 스키마 v7은 기존 날짜별 등록 내용을 보존하며 이전 등록 내용의 새 구절·역본·저작자 필드는 `null`입니다. 운영자가 해당 날짜를 다시 저장하면 새 필드가 채워집니다.

승인 회원의 나눔은 `GET /words?date=YYYY-MM-DD`로 해당 날짜만 조회합니다. `POST /words`는 `{text, date?}`를 받으며, 날짜 생략 시 한국 날짜의 오늘로 저장합니다. 자동 순환표가 적용되는 날짜에도 나눔을 작성할 수 있습니다. 기존 `/community` 응답의 `wordPosts`에는 `date` 필드가 추가됩니다. v4까지 저장한 나눔은 기존 작성 시각을 한국 날짜로 환산해 보존합니다. 과거 날짜에 실제로 어떤 질문을 읽고 작성했는지는 이전 버전에 기록되지 않았으므로, 기존 나눔과 특정 질문의 일치 여부는 보장할 수 없습니다.

가입 요청 시 이름·전화번호·교회명·12~128자 비밀번호와 동의를 받습니다. 비밀번호는 개별 salt를 넣은 scrypt 해시로 저장합니다. 동일 전화번호의 중복 요청은 거절합니다. 승인 전 공동체 변경 API는 403으로 차단합니다. 회원 세션이 만료되거나 기기를 바꿔도 전화번호·비밀번호로 다시 로그인할 수 있습니다. 5회 실패한 번호는 15분간 로그인을 제한합니다.

이전 버전에서 가입해 비밀번호가 없는 회원은 기존 세션이 살아 있다면 `/community/me`에서 비밀번호를 설정합니다. 세션도 없으면 주 운영자가 구성원 관리에서 임시 비밀번호를 발급해 회원에게 전달합니다. 발급 즉시 기존 회원 세션은 모두 무효화되며 비밀번호는 화면에 한 번만 표시됩니다. 임시 비밀번호로 로그인하면 `mustChangePassword`가 참으로 반환되고, 현재 임시 비밀번호를 확인해 새 비밀번호로 변경할 때까지 공동체 API는 403을 반환합니다. 변경 성공 시 이전 회원 세션을 모두 폐기하고 새 세션을 발급합니다. 운영 DB의 스키마 v4 적용 전 SQLite 온라인 백업은 `E:\실 서버\sai-pre-temp-password-20261002.sqlite`에 저장했습니다.

운영자 로그인은 `.env`의 주 운영자 비밀번호를 사용합니다. 주 운영자는 로그인 화면의 계정을 비워 두고 비밀번호를 입력합니다. 추가 운영자는 자신의 계정과 비밀번호를 입력합니다. 운영자 세션은 8시간, 회원 세션은 30일입니다. 운영자 계정 추가·삭제 API는 주 운영자 세션만 허용합니다.

사진은 JPEG·PNG·WebP만 허용하고 10MB를 넘으면 거절합니다. 업로드 파일은 무작위 이름으로 별도 폴더에 두고 승인 회원만 읽을 수 있습니다. 게시물 삭제·댓글 수정/삭제·좋아요·기도 반응은 서버에서 작성자 또는 회원 권한을 검사합니다. 신고 조치의 `delete`는 데이터를 물리 삭제하지 않고 게시물·댓글을 숨깁니다. 공지 예약은 승인 회원이 공동체 데이터를 조회할 때 예약 시각을 확인해 게시 상태로 바뀝니다.

프로필 사진은 승인 회원이 `POST /auth/me/avatar`의 `image` multipart 필드로 등록·교체하고 `DELETE /auth/me/avatar`로 삭제합니다. `GET /auth/me/avatar`는 본인 사진만 반환합니다. JPEG·PNG·WebP 10MB 이하를 받으며 중앙 기준으로 잘라 512×512px WebP로 `UPLOAD_DIR/avatars`에 저장합니다. 교체·삭제 시 이전 사진 파일을 정리합니다. `/auth/me`·로그인 응답의 `avatarUrl`은 사진이 없으면 `null`입니다. DB 스키마 v8은 기존 회원 데이터를 보존하면서 `avatar_file` 필드를 추가합니다.

말씀 나눔·사진 게시물·댓글 응답의 `authorAvatarUrl`은 작성자가 프로필 사진을 등록한 경우에만 제공됩니다. 승인 회원은 `GET /auth/members/:id/avatar`로 공동체 작성자의 사진을 볼 수 있습니다. 기도 글은 익명성을 유지하므로 작성자 프로필 사진을 제공하지 않습니다.

## 검증과 운영 전 확인

`pnpm typecheck`, `pnpm build`, `pnpm test`로 검사합니다. 통합 테스트는 `E:\테스트 서버` 아래에 일회성 하위 폴더와 DB를 만들고 종료 시 정리합니다. 영속적인 테스트 API는 `E:\테스트 서버\sai.sqlite`를 사용합니다. 테스트는 운영 DB에 데이터를 쓰지 않습니다. Next.js 개발 서버(3001번)는 테스트 API(4100번), 운영 서버(3000번)는 운영 API(4000번)를 사용합니다.

현재 개발에는 테스트 API `127.0.0.1:4100`과 Next.js 개발 서버 `127.0.0.1:3001`을 사용합니다. 운영 서버(4000/3000)는 종료 상태를 기본으로 유지합니다. API는 설정된 프론트엔드 출처의 변경 요청만 허용하며, 다른 출처는 403으로 거절합니다. 외부 PWA 공개에는 HTTPS 역방향 프록시, 고정된 공개 주소, PC 자동 시작·재시작, 백업 및 복구 시험, 개인정보 보관 정책이 필요합니다. 아직 외부 공개는 수행하지 않았습니다. 백업할 때는 실행 중인 DB 파일만 복사하지 말고 SQLite 백업 기능을 사용하고, 사진 폴더도 함께 보관해야 합니다.
