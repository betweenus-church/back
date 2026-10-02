# 사이 NestJS API

Next.js 프론트엔드와 분리된 NestJS 서버입니다. Node.js 24 이상, TypeScript 6, pnpm을 사용합니다. TypeScript의 `NodeNext` 모듈 해석으로 Node.js 실행 환경을 검사합니다. 운영 DB와 테스트 DB는 서버 PC의 서로 다른 폴더에 저장합니다.

## NestJS 코드 구조

- `src/app.module.ts`: 기능 모듈만 조합하는 루트 모듈
- `src/database/`: SQLite 연결·마이그레이션 서비스와 이를 내보내는 `DatabaseModule`
- `src/auth/`: 가입·운영자 로그인 컨트롤러, 인증 서비스, 회원·운영자 가드, `AuthModule`
- `src/community/`: 말씀·사진·댓글·기도·신고 컨트롤러와 서비스, `CommunityModule`
- `src/daily-word/`: 날짜별 말씀·질문 조회, 한국 날짜 검증, `DailyWordModule`
- `src/admin/`: 승인·신고 검토·구성원·설정·공지 컨트롤러와 서비스, `AdminModule`

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

날짜 기준은 `Asia/Seoul`의 `YYYY-MM-DD`입니다. `GET /daily-word`에서 날짜를 생략하면 오늘을 조회합니다. 직접 지정한 날짜가 없으면 2026-10-02를 시작점으로 하는 앱의 30일 말씀·질문 순환표를 날짜에 따라 선택합니다. 자정마다 날짜가 바뀌므로 별도 예약 작업이나 DB 쓰기가 필요 없습니다. 응답은 `{date, reference, verse, question, readingUrl, source}`이며 `source`는 `plan` 또는 `custom`입니다. 운영자가 `PUT /admin/daily-words/:date`에 `{reference, verse, question, readingUrl?}`을 보내 저장한 내용은 해당 날짜의 자동 순환표보다 우선합니다. `GET /admin/daily-words`는 직접 지정한 날짜만 반환합니다. `readingUrl`은 대한성서공회 성경플랫폼(`https://bible.bskorea.or.kr/`) 주소 또는 `null`만 허용하며, 비워 두면 알려진 말씀 위치의 장별 공식 주소를 자동 생성합니다. 순환표의 짧은 묵상 문구는 번역문 인용이 아니며 본문 전체는 공식 플랫폼에서 읽습니다. 기존 DB의 날짜별 등록 내용은 유지됩니다.

승인 회원의 나눔은 `GET /words?date=YYYY-MM-DD`로 해당 날짜만 조회합니다. `POST /words`는 `{text, date?}`를 받으며, 날짜 생략 시 한국 날짜의 오늘로 저장합니다. 자동 순환표가 적용되는 날짜에도 나눔을 작성할 수 있습니다. 기존 `/community` 응답의 `wordPosts`에는 `date` 필드가 추가됩니다. v4까지 저장한 나눔은 기존 작성 시각을 한국 날짜로 환산해 보존합니다. 과거 날짜에 실제로 어떤 질문을 읽고 작성했는지는 이전 버전에 기록되지 않았으므로, 기존 나눔과 특정 질문의 일치 여부는 보장할 수 없습니다.

가입 요청 시 이름·전화번호·교회명·12~128자 비밀번호와 동의를 받습니다. 비밀번호는 개별 salt를 넣은 scrypt 해시로 저장합니다. 동일 전화번호의 중복 요청은 거절합니다. 승인 전 공동체 변경 API는 403으로 차단합니다. 회원 세션이 만료되거나 기기를 바꿔도 전화번호·비밀번호로 다시 로그인할 수 있습니다. 5회 실패한 번호는 15분간 로그인을 제한합니다.

이전 버전에서 가입해 비밀번호가 없는 회원은 기존 세션이 살아 있다면 `/community/me`에서 비밀번호를 설정합니다. 세션도 없으면 주 운영자가 구성원 관리에서 임시 비밀번호를 발급해 회원에게 전달합니다. 발급 즉시 기존 회원 세션은 모두 무효화되며 비밀번호는 화면에 한 번만 표시됩니다. 임시 비밀번호로 로그인하면 `mustChangePassword`가 참으로 반환되고, 현재 임시 비밀번호를 확인해 새 비밀번호로 변경할 때까지 공동체 API는 403을 반환합니다. 변경 성공 시 이전 회원 세션을 모두 폐기하고 새 세션을 발급합니다. 운영 DB의 스키마 v4 적용 전 SQLite 온라인 백업은 `E:\실 서버\sai-pre-temp-password-20261002.sqlite`에 저장했습니다.

운영자 로그인은 `.env`의 주 운영자 비밀번호를 사용합니다. 주 운영자는 로그인 화면의 계정을 비워 두고 비밀번호를 입력합니다. 추가 운영자는 자신의 계정과 비밀번호를 입력합니다. 운영자 세션은 8시간, 회원 세션은 30일입니다. 운영자 계정 추가·삭제 API는 주 운영자 세션만 허용합니다.

사진은 JPEG·PNG·WebP만 허용하고 10MB를 넘으면 거절합니다. 업로드 파일은 무작위 이름으로 별도 폴더에 두고 승인 회원만 읽을 수 있습니다. 게시물 삭제·댓글 수정/삭제·좋아요·기도 반응은 서버에서 작성자 또는 회원 권한을 검사합니다. 신고 조치의 `delete`는 데이터를 물리 삭제하지 않고 게시물·댓글을 숨깁니다. 공지 예약은 승인 회원이 공동체 데이터를 조회할 때 예약 시각을 확인해 게시 상태로 바뀝니다.

## 검증과 운영 전 확인

`pnpm typecheck`, `pnpm build`, `pnpm test`로 검사합니다. 통합 테스트는 `E:\테스트 서버` 아래에 일회성 하위 폴더와 DB를 만들고 종료 시 정리합니다. 영속적인 테스트 API는 `E:\테스트 서버\sai.sqlite`를 사용합니다. 테스트는 운영 DB에 데이터를 쓰지 않습니다. Next.js 개발 서버(3001번)는 테스트 API(4100번), 운영 서버(3000번)는 운영 API(4000번)를 사용합니다.

현재 개발에는 테스트 API `127.0.0.1:4100`과 Next.js 개발 서버 `127.0.0.1:3001`을 사용합니다. 운영 서버(4000/3000)는 종료 상태를 기본으로 유지합니다. API는 설정된 프론트엔드 출처의 변경 요청만 허용하며, 다른 출처는 403으로 거절합니다. 외부 PWA 공개에는 HTTPS 역방향 프록시, 고정된 공개 주소, PC 자동 시작·재시작, 백업 및 복구 시험, 개인정보 보관 정책이 필요합니다. 아직 외부 공개는 수행하지 않았습니다. 백업할 때는 실행 중인 DB 파일만 복사하지 말고 SQLite 백업 기능을 사용하고, 사진 폴더도 함께 보관해야 합니다.
