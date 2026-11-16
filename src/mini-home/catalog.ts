type ClothingKind = "top" | "pants" | "skirt" | "socks" | "shoes";
const clothing: Record<ClothingKind, [string, string][]> = {
  top: [["크림 케이블 니트", "#efd9ad"], ["민트 하트 니트", "#91bea5"], ["복숭아 가디건", "#e6a493"], ["라벤더 후드", "#aaa0ce"], ["하늘 줄무늬 티", "#9cc7dc"], ["화이트 셔츠", "#fff7e9"], ["체리 맨투맨", "#d97e86"], ["레몬 조끼", "#e7cf81"], ["네이비 카라 티", "#657b9b"], ["숲빛 재킷", "#77977e"]],
  pants: [["연청 데님", "#98b4ce"], ["진청 데님", "#587699"], ["크림 와이드 팬츠", "#e4d5bc"], ["민트 조거 팬츠", "#8aad98"], ["차콜 슬랙스", "#69717c"], ["베이지 반바지", "#cdb291"], ["코랄 반바지", "#d9988b"], ["하늘 체크 팬츠", "#9aaec9"], ["라벤더 와이드 팬츠", "#aaa0c8"], ["카키 카고 팬츠", "#969b77"]],
  skirt: [["살구 플리츠 치마", "#e7b3a0"], ["네이비 테니스 치마", "#6d81a3"], ["크림 A라인 치마", "#e8d8bc"], ["민트 리본 치마", "#9ebdaa"], ["라벤더 프릴 치마", "#b6a6cf"], ["체리 체크 치마", "#d18c98"], ["하늘 데님 치마", "#8eabc6"], ["레몬 꽃 치마", "#e5cd87"], ["모카 단추 치마", "#b2917d"], ["숲빛 롱 치마", "#829b82"]],
  socks: [["화이트 골지 양말", "#fff8ec"], ["크림 레이스 양말", "#ebd9b7"], ["민트 발목 양말", "#a1c5af"], ["복숭아 줄무늬 양말", "#e5af9d"], ["라벤더 골지 양말", "#b7acd3"], ["하늘 도트 양말", "#a4c7db"], ["체리 하트 양말", "#d8949d"], ["레몬 발목 양말", "#e7d18c"], ["네이비 줄무늬 양말", "#7589a6"], ["숲빛 무릎 양말", "#8ca78d"]],
  shoes: [["크림 스니커즈", "#efe3cb"], ["민트 운동화", "#90bba4"], ["복숭아 메리제인", "#d99d8c"], ["라벤더 캔버스화", "#aaa0ca"], ["하늘 러닝화", "#91b8d0"], ["화이트 벨크로화", "#fff7e9"], ["체리 플랫슈즈", "#cf7d8c"], ["레몬 슬립온", "#dfc777"], ["네이비 로퍼", "#637b99"], ["모카 앵클부츠", "#a48069"]],
};
const maleClothing: Record<ClothingKind, [string, string][]> = {
  top: [["오트밀 케이블 니트", "#d5c4a3"], ["그린 배지 니트", "#728d78"], ["모카 가디건", "#aa8973"], ["네이비 후드", "#536c8a"], ["블루 줄무늬 티", "#7d9db6"], ["아이보리 셔츠", "#e5ddcf"], ["버건디 스포츠 맨투맨", "#a36570"], ["올리브 조끼", "#92996c"], ["차콜 카라 티", "#68717c"], ["브라운 필드 재킷", "#947961"]],
  pants: [["빈티지 연청 데님", "#829eb7"], ["인디고 데님", "#405b7c"], ["샌드 와이드 팬츠", "#c5b494"], ["올리브 조거 팬츠", "#808c6a"], ["블랙 슬랙스", "#4f5660"], ["카멜 반바지", "#b69876"], ["네이비 반바지", "#607994"], ["브라운 체크 팬츠", "#998576"], ["그레이 와이드 팬츠", "#999da0"], ["딥카키 카고 팬츠", "#6e7d62"]],
  skirt: [["차콜 플리츠 킬트", "#747a82"], ["네이비 플리츠 킬트", "#596e8a"], ["샌드 랩 스커트", "#c0af90"], ["올리브 벨트 킬트", "#899574"], ["블랙 레이어드 킬트", "#626571"], ["브라운 체크 킬트", "#a08574"], ["인디고 데님 킬트", "#708ca5"], ["카키 포켓 킬트", "#a1a478"], ["모카 단추 킬트", "#947965"], ["딥그린 롱 킬트", "#657f6e"]],
  socks: [["아이보리 골지 양말", "#e9e1d2"], ["샌드 스포츠 양말", "#cdbf9e"], ["올리브 발목 양말", "#9da788"], ["브라운 줄무늬 양말", "#b59b86"], ["그레이 골지 양말", "#a5a7af"], ["블루 도트 양말", "#92a8ba"], ["버건디 스포츠 양말", "#b57f86"], ["카키 발목 양말", "#b7b88e"], ["네이비 라인 양말", "#697f9a"], ["그린 무릎 양말", "#83947b"]],
  shoes: [["샌드 스니커즈", "#d3c4aa"], ["그린 운동화", "#7b9680"], ["브라운 보트슈즈", "#b08b73"], ["차콜 캔버스화", "#7c818a"], ["블루 러닝화", "#7695ad"], ["아이보리 벨크로화", "#e8e1d5"], ["버건디 코트화", "#a16c77"], ["올리브 슬립온", "#969b6e"], ["네이비 페니로퍼", "#526d87"], ["브라운 워커", "#8b6d57"]],
};
const maleItems = Object.entries(maleClothing).flatMap(([kind, entries]) => entries.map(([name, color], index) => ({
  id: `${kind}-male-${index + 1}`, kind: kind as ClothingKind, name, description: `${name}로 나만의 코디를 완성해 보세요.`, price: 100, color,
})));
const maleCharacters = [
  ["밤빛 가르마 머리", "#5c4336"], ["블랙 댄디 머리", "#363432"], ["카라멜 투블럭", "#92704d"], ["버건디 가르마 머리", "#925c62"], ["애쉬 짧은 머리", "#797487"],
  ["네이비 댄디 머리", "#41516c"], ["골드 짧은 머리", "#b5985f"], ["모카 곱슬 머리", "#6c4a35"], ["실버 안경 머리", "#85949b"], ["브라운 포마드 머리", "#89513d"],
].map(([name, color], index) => ({ id: `character-male-${index + 1}`, kind: "character" as const, name, description: "나를 표현하는 남자 도트 캐릭터 · 옷은 그대로 유지돼요.", price: 100, color }));

const clothingItems = Object.entries(clothing).flatMap(([kind, entries]) => entries.map(([name, color], index) => ({
  id: `${kind}-${index + 1}`, kind: kind as ClothingKind, name, description: `${name}로 나만의 코디를 완성해 보세요.`, price: 100, color,
})));

const characters = [
  ["밤빛 긴 머리", "#855c46"], ["단정한 까만 머리", "#443b36"], ["카라멜 단발", "#a27551"], ["로즈 긴 머리", "#b97582"], ["라벤더 단발", "#827096"],
  ["블루 짧은 머리", "#485875"], ["골드 양갈래", "#c09b61"], ["모카 곱슬 안경", "#77533d"], ["실버 짧은 머리 안경", "#88969d"], ["오렌지 올림 머리", "#9b5941"],
].map(([name, color], index) => ({ id: `character-${index + 1}`, kind: "character" as const, name, description: "나를 표현하는 도트 캐릭터 · 입고 있던 옷은 그대로 유지돼요.", price: 100, color }));

const allItems = [
  ...maleItems,
  ...maleCharacters,
  ...characters,
  { id: "character-basic", kind: "character", name: "기본 도트 캐릭터", description: "처음부터 함께하는 나의 캐릭터", price: 0, color: "#855c46" },
  ...clothingItems,
  { id: "top-basic", kind: "top", name: "기본 크림 니트", description: "처음부터 함께하는 기본 상의", price: 0, color: "#f0dcb7" },
  { id: "pants-basic", kind: "pants", name: "기본 팬츠", description: "편안한 기본 하의", price: 0, color: "#768396" },
  { id: "socks-basic", kind: "socks", name: "기본 양말", description: "포근한 기본 양말", price: 0, color: "#fff8ec" },
  { id: "shoes-basic", kind: "shoes", name: "기본 운동화", description: "가벼운 기본 운동화", price: 0, color: "#fffaf0" },
  { id: "outfit-basic", kind: "outfit", name: "포근한 크림 니트", description: "처음 만나는 나의 캐릭터", price: 0, color: "#f0dcb7" },
  { id: "outfit-mint", kind: "outfit", name: "민트 산책복", description: "가벼운 마음으로 함께 걸어요", price: 100, color: "#91bea5" },
  { id: "outfit-navy", kind: "outfit", name: "네이비 멜빵", description: "작은 순간을 기록하는 날", price: 100, color: "#667c9c" },
  { id: "outfit-peach", kind: "outfit", name: "복숭아 가디건", description: "따뜻한 인사를 건네요", price: 100, color: "#e6a493" },
  { id: "outfit-lavender", kind: "outfit", name: "라벤더 후드", description: "편안하게 쉬어 가는 시간", price: 100, color: "#aaa0ce" },
  { id: "room-basic", kind: "room", name: "햇살 한 칸", description: "소박하고 따뜻한 나의 첫 방", price: 0, color: "#f2e8d9" },
  { id: "room-cozy", kind: "room", name: "책과 커피의 방", description: "책장과 소파가 있는 아늑한 공간", price: 500, color: "#e5d8c7" },
  { id: "room-garden", kind: "room", name: "초록빛 온실", description: "식물과 햇빛으로 채운 작은 정원", price: 700, color: "#d3e6d4" },
  { id: "room-night", kind: "room", name: "별빛 다락방", description: "별을 보며 하루를 마무리해요", price: 1000, color: "#707da0" },
] as const;

export const MINI_HOME_ITEMS = allItems.map(item => ({ ...item,
  gender: item.price === 0 || item.kind === "room" || item.kind === "outfit" ? "unisex" as const : item.id.includes("-male-") ? "male" as const : "female" as const,
}));

export const POINT_ACTIVITIES = [
  { id: "comment", name: "댓글 달기", points: 10, href: "/community/photos" },
  { id: "photo", name: "사진 올리기", points: 50, href: "/community/photos" },
  { id: "like", name: "좋아요 누르기", points: 10, href: "/community/word" },
  { id: "prayer", name: "기도 제목 나누기", points: 20, href: "/community/prayer" },
  { id: "word", name: "말씀 읽고 나눔 글 쓰기", points: 20, href: "/community/word" },
] as const;
export type PointActivity = typeof POINT_ACTIVITIES[number]["id"];
