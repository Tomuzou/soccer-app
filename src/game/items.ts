export const ITEMS = [
  {
    id: "none",
    icon: "⚽",
    name: "ノーマル",
    description: "道具に頼らず、実力勝負。",
    speed: 1,
    spin: 1,
    radius: 1,
    drag: 1,
    tint: 0xffffff,
  },
  {
    id: "banana",
    icon: "🍌",
    name: "バナナ職人",
    description: "カーブ4倍。曲がりすぎ注意！",
    speed: 1,
    spin: 4,
    radius: 1,
    drag: 1,
    tint: 0xffed94,
  },
  {
    id: "rocket",
    icon: "🚀",
    name: "ロケットスパイク",
    description: "初速2.3倍。キーパー、見えてる？",
    speed: 2.3,
    spin: 1,
    radius: 1,
    drag: 0.65,
    tint: 0xffc7ac,
  },
  {
    id: "tiny",
    icon: "🫛",
    name: "豆つぶボール",
    description: "直径半分。当たり判定も小さく。",
    speed: 1,
    spin: 1,
    radius: 0.5,
    drag: 0.65,
    tint: 0xc6f36b,
  },
] as const;
export type ItemId = (typeof ITEMS)[number]["id"];
export const itemFor = (id: ItemId) =>
  ITEMS.find((item) => item.id === id) ?? ITEMS[0];
