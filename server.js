/* ============================================================
   كرت فكة - سيرفر اللعبة (v3)
   تشغيل: node server.js
   اللعيبة يفتحوا من موبايلاتهم: http://<IP-اللابتوب>:3000

   مودات اللعب:
   - guess  : التخمين الكلاسيكي (كل واحد شخصية سرية من نفس الكاتيجوري)
   - spy    : لعبة الجاسوس (كلمة واحدة للكل + جاسوس/ات مخفيين + تصويت بالأغلبية)
   - auction: مزاد النجوم (مزايدة على كروت فيفا + خطف اللاعب + تشكيلة 5/11)
   ============================================================ */
const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

/* ---------------------------------------------
   Protocol Version — بيمنع دخول عملاء قديمة على سيرفر جديد
   لو نسخة العميل (v) أقل من اللي هنا أو غايبة → رفض + رسالة تحديث
   --------------------------------------------- */
const PROTOCOL_VERSION = 6;
const VERSION_MESSAGE = '⚠️ نسختك قديمة — حدّث التطبيق من السيرفر أو أعد فتح الصفحة';

/* ------------------------- بيانات كرة القدم (للمزاد) ------------------------- */
const FOOTBALL = require('./players.json'); // { colors, players: [{n,e,t,c,p,num,champs,ach,prev,r,pos,v}] }
const POS_LABEL = { GK: 'حارس مرمى', DF: 'مدافع', MF: 'وسط', FW: 'مهاجم' };
const POS_EMOJI = { GK: '🧤', DF: '🛡️', MF: '🎯', FW: '⚽' };

/* ------------------------- أسئلة لعبة «مين الكذاب؟» ------------------------- */
const LIAR_QUESTIONS = require('./public/liar-questions.json'); // [{ q: "..." }]

/* ------------------------- صور ومعلومات الشخصيات ------------------------- */
const CHAR_IMG = require('./public/char-img.json');   // { الاسم العربي: "slug.ext" } — الصور الفعلية داخل التطبيق
const CHAR_BIO = require('./public/char-bio.json');   // { الاسم العربي: "وصف مختصر" } لغير اللاعيبة
const PLAYER_BY_NAME = {};                            // الاسم العربي -> بروفايل اللاعب
for (const pl of FOOTBALL.players) {
  if (pl && pl.n) PLAYER_BY_NAME[pl.n] = pl;
}
function jerseyColorOf(team) {
  const c = team ? FOOTBALL.colors[team] : null;
  return c || '#24243a';
}
function charImageOf(name, profile) {
  // الاسم المباشر أو اسم اللاعب الكامل (أو اشتقاق من الاسم الإنجليزي)
  if (CHAR_IMG[name]) return CHAR_IMG[name];
  if (profile) {
    if (CHAR_IMG[profile.n]) return CHAR_IMG[profile.n];
    const slug = String(profile.e || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    const hit = Object.values(CHAR_IMG).find((v) => v.startsWith(slug + '.'));
    if (hit) return hit;
  }
  return null;
}

function priceOf(r) {
  if (r >= 89) return 90; if (r >= 86) return 65; if (r >= 83) return 45;
  if (r >= 80) return 30; if (r >= 77) return 20; if (r >= 74) return 13;
  if (r >= 71) return 9; return 6;
}
function cardBase(card) { return Math.max(5, Math.round(card.v * 0.6)); }

/* ------------------------- الكاتيجوريات وشخصياتها ------------------------- */
const CATEGORIES = [
  {
    id: 'sports',
    name: 'الكورة والرياضة',
    emoji: '⚽',
    chars: [
      { name: 'محمد صلاح', emoji: '⚽' },
      { name: 'أبو تريكة', emoji: '🔟' },
      { name: 'تريزيجيه', emoji: '⚽' },
      { name: 'عمر مرموش', emoji: '🚀' },
      { name: 'مصطفى محمد', emoji: '⚽' },
      { name: 'شيكابالا', emoji: '🃏' },
      { name: 'عصام الحضري', emoji: '🧤' },
      { name: 'أحمد رفعت', emoji: '⚽' },
      { name: 'محمود الخطيب', emoji: '🦅' },
      { name: 'أحمد حسن', emoji: '⚽' },
      { name: 'حسام حسن', emoji: '⚽' },
      { name: 'محمد أبو جبل', emoji: '🧤' },
      { name: 'ليونيل ميسي', emoji: '🐐' },
      { name: 'كريستيانو رونالدو', emoji: '👑' },
      { name: 'نيمار', emoji: '💫' },
      { name: 'كيليان مبابي', emoji: '🐢' },
      { name: 'إيرلينج هالاند', emoji: '🤖' },
      { name: 'زين الدين زيدان', emoji: '🇫🇷' },
      { name: 'رونالدينيو', emoji: '😁' },
      { name: 'ماريو بالوتيلي', emoji: '🔥' },
      { name: 'نور الشربيني', emoji: '🏆' },
      { name: 'رامي عاشور', emoji: '🏸' },
      { name: 'علي فرج', emoji: '🎾' },
      { name: 'إيهاب أمير', emoji: '🥋' },
    ],
  },
  {
    id: 'artists',
    name: 'فنانين ومطربين',
    emoji: '🎤',
    chars: [
      { name: 'عمرو دياب', emoji: '🎤' },
      { name: 'تامر حسني', emoji: '🎬' },
      { name: 'محمد رمضان', emoji: '🦖' },
      { name: 'أحمد حلمي', emoji: '😄' },
      { name: 'كريم عبد العزيز', emoji: '🎭' },
      { name: 'محمد منير', emoji: '🌙' },
      { name: 'شيرين عبد الوهاب', emoji: '🎵' },
      { name: 'أنغام', emoji: '🎼' },
      { name: 'أحمد عز', emoji: '🍫' },
      { name: 'هند صبري', emoji: '🎬' },
      { name: 'منى زكي', emoji: '⭐' },
      { name: 'دنيا سمير غانم', emoji: '😂' },
      { name: 'ياسمين صبري', emoji: '💃' },
      { name: 'هاني شاكر', emoji: '🎙️' },
      { name: 'محمد حماقي', emoji: '🎸' },
      { name: 'رامي جمال', emoji: '🎹' },
      { name: 'أكرم حسني', emoji: '🤣' },
      { name: 'يوسف الشريف', emoji: '🕶️' },
      { name: 'أحمد السقا', emoji: '💪' },
      { name: 'نانسي عجرم', emoji: '🌸' },
      { name: 'إليسا', emoji: '🌹' },
      { name: 'وائل كفوري', emoji: '🎻' },
      { name: 'راغب علامة', emoji: '🎶' },
      { name: 'اليسار', emoji: '🕺' },
    ],
  },
  {
    id: 'celebs',
    name: 'مشاهير وشخصيات عالمية',
    emoji: '🌟',
    chars: [
      { name: 'ليوناردو دي كابريو', emoji: '🎥' },
      { name: 'توم كروز', emoji: '🏍️' },
      { name: 'دواين جونسون', emoji: '🪨' },
      { name: 'إيلون ماسك', emoji: '🚗' },
      { name: 'ريهانا', emoji: '💎' },
      { name: 'بيكاسو', emoji: '🎨' },
      { name: 'ألبرت أينشتاين', emoji: '🧠' },
      { name: 'إسحاق نيوتن', emoji: '🍎' },
      { name: 'نابليون بونابرت', emoji: '🤵' },
      { name: 'بيل جيتس', emoji: '💻' },
      { name: 'ستيف جوبز', emoji: '🍏' },
      { name: 'محمد علي كلاي', emoji: '🥊' },
      { name: 'مايكل جوردان', emoji: '🏀' },
      { name: 'يوسين بولت', emoji: '🏃' },
      { name: 'تايلور سويفت', emoji: '🎸' },
      { name: 'كليوباترا', emoji: '👑' },
      { name: 'شارلي شابلن', emoji: '🎩' },
      { name: 'فان جوخ', emoji: '🌻' },
    ],
  },
  {
    id: 'cartoon',
    name: 'كرتون وأنمي',
    emoji: '🧸',
    chars: [
      { name: 'سبونج بوب', emoji: '🧽' },
      { name: 'توم وجيري', emoji: '🐱' },
      { name: 'ميكي ماوس', emoji: '🐭' },
      { name: 'بات مان', emoji: '🦇' },
      { name: 'سوبر مان', emoji: '🦸' },
      { name: 'سبايدر مان', emoji: '🕷️' },
      { name: 'بيكاتشو', emoji: '⚡' },
      { name: 'شون ذا شيب', emoji: '🐑' },
      { name: 'دورا', emoji: '🎒' },
      { name: 'أولاف', emoji: '⛄' },
      { name: 'سيمبا', emoji: '🦁' },
      { name: 'باباي', emoji: '🥫' },
      { name: 'شريك', emoji: '💚' },
      { name: 'علاء الدين', emoji: '🧞' },
      { name: 'سندريلا', emoji: '👗' },
      { name: 'هاري بوتر', emoji: '🪄' },
      { name: 'كابتن ماجد', emoji: '⚽' },
      { name: 'باربي', emoji: '🩷' },
      { name: 'ماشا والدب', emoji: '🐻' },
      { name: 'سونيك', emoji: '🦔' },
      { name: 'نيمو', emoji: '🐠' },
    ],
  },
  {
    id: 'animals',
    name: 'حيوانات',
    emoji: '🦁',
    chars: [
      { name: 'أسد', emoji: '🦁' },
      { name: 'فيل', emoji: '🐘' },
      { name: 'زرافة', emoji: '🦒' },
      { name: 'بطريق', emoji: '🐧' },
      { name: 'حصان', emoji: '🐴' },
      { name: 'قرد', emoji: '🐒' },
      { name: 'نمر', emoji: '🐯' },
      { name: 'دب', emoji: '🐻' },
      { name: 'تمساح', emoji: '🐊' },
      { name: 'أرنب', emoji: '🐰' },
      { name: 'قطة', emoji: '🐱' },
      { name: 'كلب', emoji: '🐶' },
      { name: 'غزال', emoji: '🦌' },
      { name: 'سلحفاة', emoji: '🐢' },
      { name: 'بومة', emoji: '🦉' },
      { name: 'دولفين', emoji: '🐬' },
      { name: 'ثعلب', emoji: '🦊' },
      { name: 'بطة', emoji: '🦆' },
    ],
  },
  {
    id: 'jobs',
    name: 'وظائف ومهن',
    emoji: '🧑‍⚕️',
    chars: [
      { name: 'دكتور', emoji: '👨‍⚕️' },
      { name: 'مهندس', emoji: '👷' },
      { name: 'طباخ', emoji: '👨‍🍳' },
      { name: 'رجل إطفاء', emoji: '👨‍🚒' },
      { name: 'شرطي', emoji: '👮' },
      { name: 'مدرس', emoji: '👨‍🏫' },
      { name: 'رائد فضاء', emoji: '👨‍🚀' },
      { name: 'مغني', emoji: '🎤' },
      { name: 'بحار', emoji: '⚓' },
      { name: 'سائق', emoji: '🚗' },
      { name: 'مزارع', emoji: '🧑‍🌾' },
      { name: 'نجار', emoji: '🪚' },
      { name: 'محامي', emoji: '⚖️' },
      { name: 'قاضي', emoji: '🧑‍⚖️' },
      { name: 'صياد', emoji: '🎣' },
      { name: 'مصور', emoji: '📷' },
      { name: 'طيار', emoji: '👨‍✈️' },
      { name: 'حلاق', emoji: '💈' },
      { name: 'جندي', emoji: '🪖' },
    ],
  },
  {
    id: 'foods',
    name: 'أكلات',
    emoji: '🍉',
    chars: [
      { name: 'بطيخ', emoji: '🍉' },
      { name: 'مانجو', emoji: '🥭' },
      { name: 'كشري', emoji: '🍛' },
      { name: 'شاورما', emoji: '🌯' },
      { name: 'ذرة مشوي', emoji: '🌽' },
      { name: 'فراولة', emoji: '🍓' },
      { name: 'فول وفلافل', emoji: '🫘' },
      { name: 'بيتزا', emoji: '🍕' },
      { name: 'كنافة', emoji: '🍮' },
      { name: 'بقلاوة', emoji: '🍰' },
      { name: 'أم علي', emoji: '🍮' },
      { name: 'عصير قصب', emoji: '🧃' },
      { name: 'ملوخية', emoji: '🥬' },
      { name: 'محشي', emoji: '🍅' },
      { name: 'كفتة', emoji: '🍢' },
      { name: 'تمر', emoji: '🌴' },
      { name: 'جبنة', emoji: '🧀' },
      { name: 'عيش بلدي', emoji: '🍞' },
      { name: 'فسيخ', emoji: '🐟' },
      { name: 'سلطة', emoji: '🥗' },
    ],
  },
  {
    id: 'things',
    name: 'أشياء',
    emoji: '🌳',
    chars: [
      { name: 'شجرة', emoji: '🌳' },
      { name: 'قمر', emoji: '🌙' },
      { name: 'شمس', emoji: '☀️' },
      { name: 'مروحة', emoji: '🌀' },
      { name: 'سيارة', emoji: '🚗' },
      { name: 'موبايل', emoji: '📱' },
      { name: 'كتاب', emoji: '📖' },
      { name: 'قلم', emoji: '✏️' },
      { name: 'ساعة', emoji: '⌚' },
      { name: 'نظارة', emoji: '👓' },
      { name: 'حذاء', emoji: '👟' },
      { name: 'مفتاح', emoji: '🗝️' },
      { name: 'طائرة', emoji: '✈️' },
      { name: 'قطار', emoji: '🚂' },
      { name: 'دراجة', emoji: '🚲' },
      { name: 'تلفزيون', emoji: '📺' },
      { name: 'لابتوب', emoji: '💻' },
      { name: 'كوباية شاي', emoji: '🍵' },
      { name: 'شمعة', emoji: '🕯️' },
      { name: 'مظلة', emoji: '☂️' },
    ],
  },
];

const ALL_CHARS = CATEGORIES.flatMap((c) => c.chars);

const CATEGORY_INFO = [
  { id: 'mix', name: '🎲 عشوائي (مخلوط)', emoji: '🎲' },
  ...CATEGORIES.map((c) => ({ id: c.id, name: c.name, emoji: c.emoji })),
];

/* ------------------------- أدوات مساعدة ------------------------- */
function genCode(len = 5) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < len; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

// الرابط العام المباشر للأوضة: من Host header بتاع صاحب الأوضة نفسه
// على الشبكة = http://192.168.x.x:3000 — وعلى الإنترنت (بعد النشر) = https://app....
function publicUrlOf(socket) {
  const hd = (socket.handshake && socket.handshake.headers) || {};
  const host = String(hd.host || '').trim();
  if (!host) return null;
  const proto = String(hd['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return proto + '://' + host;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// تطبيع الاسم عشان المقارنة تبقى سهلة وغفران أخطاء الهمزة والتاء المربوطة
function normalize(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[\u064B-\u0652\u0640]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ئ/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ء/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getLanIPs() {
  const ips = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) ips.push(iface.address);
    }
  }
  return ips;
}

function charsOf(categoryId) {
  if (categoryId === 'mix') return ALL_CHARS;
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  return cat ? cat.chars : ALL_CHARS;
}

/* مستويات صعوبة لعيبة الكورة (التخمين): سهل = أعلى تقييم / اشهر الأسماء */
const DIFF_NAMES = { all: 'الكل', easy: '🟢 سهل', medium: '🟡 متوسط', hard: '🔴 صعب' };
function tierOfRating(r) {
  if (r >= 89) return 'easy';
  if (r >= 84) return 'medium';
  return 'hard';
}
function isDiff(d) { return d === 'easy' || d === 'medium' || d === 'hard' || d === 'all'; }

function pickCharacters(n, categoryId, excludeNames = [], difficulty) {
  let pool = charsOf(categoryId).filter((c) => !excludeNames.includes(c.name));
  if (categoryId === 'sports' && isDiff(difficulty) && difficulty !== 'all') {
    pool = pool.filter((c) => {
      const prof = PLAYER_BY_NAME[c.name];
      const r = prof ? prof.r : null;
      // الثابتين/الأساطير والرياضيين من غير تقييم كلهم مشهورين => في السهل
      if (r == null) return difficulty === 'easy';
      return tierOfRating(r) === difficulty;
    });
  }
  const copy = shuffle(pool);
  return copy.slice(0, n);
}

/* ------------------------- إدارة الغرف ------------------------- */
const rooms = new Map(); // code -> room

function createRoom(socket, name, mode) {
  const code = genCode();
  const room = {
    code,
    host: socket.id,
    players: new Map(), // socketId -> p
    state: 'lobby', // lobby | playing | over
    mode: mode === 'spy' ? 'spy' : mode === 'auction' ? 'auction' : mode === 'liar' ? 'liar' : 'guess',
    categoryId: mode === 'spy' ? 'sports' : 'mix',
    difficulty: 'all', // all | easy | medium | hard — اختيار صاحب الأوضة للعبة الكورة (التخمين)
    spiesCount: 1,
    doubleAgent: false, // مود الجاسوس: فيه عميل مزدوج شبه مدني شايف الكلمة لكنه مع الجواسيس
    spiesWon: null,
    word: null,
    usedWords: [],
    liar: null, // حالة لعبة «مين الكذاب؟»
    chat: [],
    order: [],
    turnIndex: 0,
    winnerId: null,
    lanIP: getLanIPs()[0] || '',
    publicURL: publicUrlOf(socket),
    squadSize: 5, // حجم التشكيلة في المزاد (5 أو 11)
    points: {}, // نقاط اللعيبة المستمرة (id -> نقاط)
    auction: null, // حالة مود المزاد
    auctionResult: null, // النتيجة النهائية للمزاد (عند الانتهاء)
    votePrompt: false, // صاحب الأوضة طلب تصويت عاجل
    voteResponses: {}, // id -> 'now' | 'later'
    voteOpen: false, // نافذة التصويت على الجاسوس شغالة
    voteTargets: [],
    voteMap: {}, // voterId -> targetId
  };
  rooms.set(code, room);
  addPlayer(room, socket, name);
  return room;
}

function addPlayer(room, socket, name) {
  room.players.set(socket.id, {
    id: socket.id,
    name,
    char: null,
    emoji: null,
    isSpy: false,
    isDoubleAgent: false,
    eliminated: false,
    connected: true,
  });
  socket.join(room.code);
}

function activePlayers(room) {
  return [...room.players.values()].filter((p) => p.connected && !p.eliminated);
}

function findRoomOf(socketId) {
  for (const room of rooms.values()) {
    if (room.players.has(socketId)) return room;
  }
  return null;
}

/* ---------------- منطق المزاد ---------------- */
function formFor(size) {
  if (size === 11) return ['GK', 'DF', 'DF', 'DF', 'DF', 'MF', 'MF', 'MF', 'FW', 'FW', 'FW'];
  return ['GK', 'DF', 'DF', 'MF', 'FW'];
}

function startAuction(room, actives) {
  const size = room.squadSize;
  const needs = formFor(size);
  const pools = { GK: [], DF: [], MF: [], FW: [] };
  for (const pl of shuffle(FOOTBALL.players)) pools[pl.pos].push(pl);

  const deck = [];
  for (let slot = 0; slot < needs.length; slot++) {
    const pos = needs[slot];
    for (let i = 0; i < actives.length; i++) {
      let card = pools[pos].shift();
      if (!card) {
        const anyPos = ['GK', 'DF', 'MF', 'FW'].find((pp) => pools[pp].length);
        card = anyPos ? pools[anyPos].shift() : null;
      }
      if (!card) break;
      deck.push({ n: card.n, r: card.r, pos: card.pos, t: card.t, c: card.c, num: card.num, e: card.e });
    }
  }

  const spare = shuffle([...pools.GK, ...pools.DF, ...pools.MF, ...pools.FW]);

  room.auction = {
    deck,
    cardIndex: 0,
    currentBid: 0,
    bidTurn: 0,
    bidders: actives.map((p) => p.id),
    budgets: Object.fromEntries(actives.map((p) => [p.id, size === 11 ? 450 : 200])),
    teams: Object.fromEntries(actives.map((p) => [p.id, []])),
    poolLeft: [],
    spare,
    phase: 'bidding', // bidding | steal
    stealOrder: [],
    stealTurn: 0,
    stealUsed: Object.fromEntries(actives.map((p) => [p.id, false])),
  };
  room.order = shuffle(actives.map((p) => p.id));
  room.turnIndex = 0;
  room.winnerId = null;
  room.spiesWon = null;
  room.auctionResult = null;
  room.state = 'playing';
  const A0 = room.auction;
  if (A0.deck.length) A0.currentBid = cardBase(A0.deck[0]); // أول كارت يبدأ بسعره الأساسي
  room.chat.push({
    from: 'النظام',
    text: `🔨 مزاد النجوم بدأ! ${actives.length} لاعبين بيتنافسوا على ${deck.length} كارت (تشكيلة ${size}). الميزانية ${size === 11 ? 450 : 200} مليون 💰 — كل كارت ليه سعر بداية وبعدين مزايدة بالتناوب`,
    ts: Date.now(), system: true,
  });
}

function currentCard(room) {
  const a = room.auction;
  return (a && a.deck[a.cardIndex]) || null;
}

function squadNeed(room) {
  return formFor(room.squadSize).length;
}

function someoneNeedsCards(room) {
  const a = room.auction;
  const need = squadNeed(room);
  return Object.values(a.teams).some((t) => t.length < need);
}

function resetCard(room) {
  const a = room.auction;
  const need = squadNeed(room);
  // أي كروت فاضية ومحدش عايزها (كل التشكيلات كملت) → تتلحق للمخزون ونتخطاها
  while (currentCard(room) && !someoneNeedsCards(room)) {
    a.poolLeft.push(a.deck[a.cardIndex]);
    a.cardIndex++;
  }
  const card = currentCard(room);
  a.currentBid = card ? cardBase(card) : 0;
  a.bidTurn = 0;
  a.needed = need;
  a.bidders = activePlayers(room).filter((p) => a.teams[p.id].length < need).map((p) => p.id);
}

function nextAuctionTurn(room) {
  const a = room.auction;
  if (!a.bidders.length) return;
  a.bidTurn = (a.bidTurn + 1) % a.bidders.length;
}

function sellCardTo(room, winnerId, price, unsold) {
  const a = room.auction;
  const card = currentCard(room);
  if (!card) return;
  const w = room.players.get(winnerId);
  if (unsold || price > a.budgets[winnerId] || !w) {
    a.poolLeft.push(card);
    room.chat.push({ from: 'النظام', text: `😴 ما حدش اشترى ${POS_EMOJI[card.pos]} ${card.n} — الكارت راح للمخزون`, ts: Date.now(), system: true });
  } else {
    a.budgets[winnerId] -= price;
    a.teams[winnerId].push({ ...card, price });
    room.chat.push({ from: 'النظام', text: `🏆 ${w.name} كسب ${POS_EMOJI[card.pos]} ${card.n} بــ ${price} مليون 💰`, ts: Date.now(), system: true });
  }
  a.cardIndex++;
  nextAuctionCard(room);
}

function nextAuctionCard(room) {
  const a = room.auction;
  resetCard(room);
  if (a.cardIndex >= a.deck.length) {
    fillTeams(room);
    a.phase = 'steal';
    a.stealOrder = activePlayers(room).map((p) => p.id);
    a.stealTurn = 0;
    room.chat.push({ from: 'النظام', text: '🔄 المزاد خلص! دلوقتي مرحلة الخطف: كل واحد ليه كارت خطف واحد يستخدمه مرة واحدة عشان ياخد لاعب من تشكيلة حد تاني', ts: Date.now(), system: true });
  }
}

function fillTeams(room) {
  const a = room.auction;
  const need = formFor(room.squadSize).length;
  for (const id of Object.keys(a.teams)) {
    while (a.teams[id].length < need) {
      const card = a.poolLeft.shift() || a.spare.shift() || null;
      if (!card) break;
      a.teams[id].push({ ...card, price: 0 });
    }
  }
}

function lowestCardOf(team) {
  let idx = 0;
  for (let i = 1; i < team.length; i++) if (team[i].r < team[idx].r) idx = i;
  return idx;
}

function stealAction(room, socket, data, ack) {
  const a = room.auction;
  if (!a || a.phase !== 'steal') return;
  if (a.stealOrder[a.stealTurn] !== socket.id) { ack && ack({ ok: false, error: 'مش دورك في الخطف 🤨' }); return; }
  if (a.stealUsed[socket.id]) return;
  const me = room.players.get(socket.id);
  if (!me) return;

  if (data && data.steal === true) {
    const targetId = data.targetId;
    const cardIndex = Number(data.cardIndex);
    const target = room.players.get(targetId);
    if (!target || targetId === socket.id || !target.connected) { ack && ack({ ok: false, error: 'هدف غير صالح' }); return; }
    const tTeam = a.teams[targetId] || [];
    if (!tTeam[cardIndex]) { ack && ack({ ok: false, error: 'اللاعب اللي اخترته مش موجود' }); return; }
    const myTeam = a.teams[socket.id] || [];
    if (!myTeam.length) { ack && ack({ ok: false, error: 'تشكيلتك فاضية' }); return; }
    const myLow = lowestCardOf(myTeam); // index في فريقي أرخص كارت
    const stolen = tTeam.splice(cardIndex, 1)[0];
    const given = myTeam.splice(myLow, 1)[0];
    // مقايضة: الهدف ياخد أرخص عندي، وأنا باخد اللي خطفته
    tTeam.push(given);
    myTeam.push(stolen);
    a.stealUsed[socket.id] = true;
    room.chat.push({ from: 'النظام', text: `⚡ ${me.name} خطف ${POS_EMOJI[stolen.pos]} ${stolen.n} من ${target.name} وسيب له ${given.n}!`, ts: Date.now(), system: true });
  } else {
    a.stealUsed[socket.id] = true;
    room.chat.push({ from: 'النظام', text: `⏭️ ${me.name} اختار يعدي على الخطف`, ts: Date.now(), system: true });
  }
  a.stealTurn++;
  if (a.stealTurn >= a.stealOrder.length) endAuction(room);
  broadcastRoom(room);
  ack && ack({ ok: true });
}

function endAuction(room) {
  const a = room.auction;
  const sums = Object.entries(a.teams)
    .map(([id, team]) => ({ id, total: team.reduce((s, c) => s + c.r, 0), team }))
    .sort((x, y) => y.total - x.total);
  room.auctionResult = sums;
  room.winnerId = sums.length ? sums[0].id : null;
  if (sums.length >= 2) room.points[sums[0].id] = (room.points[sums[0].id] || 0) + 3;
  if (sums.length >= 4) room.points[sums[1].id] = (room.points[sums[1].id] || 0) + 1;
  room.state = 'over';
  const winner = room.players.get(room.winnerId);
  room.chat.push({
    from: 'النظام',
    text: winner ? `🏆 ${winner.name} كسب المزاد بأعلى مجموع تقييم ${sums[0] ? sums[0].total : 0}!` : 'المزاد خلص',
    ts: Date.now(), system: true,
  });
  room.auction = null;
}

function handleAuctionLeave(room, socketId) {
  const a = room.auction;
  if (!a) return;
  delete a.budgets[socketId];
  delete a.teams[socketId];
  delete a.stealUsed[socketId];
  if (activePlayers(room).length < 2) { endAuction(room); return; }
  if (a.phase === 'bidding') {
    a.bidders = a.bidders.filter((id) => id !== socketId);
    if (a.bidTurn >= a.bidders.length && a.bidders.length) a.bidTurn = 0;
    if (!a.bidders.length) {
      sellCardTo(room, null, 0, true); // الكارت من غير بائع
    } else if (a.bidders.length === 1) {
      sellCardTo(room, a.bidders[0], a.currentBid, false);
    } else {
      broadcastRoom(room);
    }
  } else if (a.phase === 'steal') {
    a.stealOrder = a.stealOrder.filter((id) => id !== socketId);
    while (a.stealTurn < a.stealOrder.length && a.stealUsed[a.stealOrder[a.stealTurn]]) a.stealTurn++;
    if (a.stealTurn >= a.stealOrder.length) endAuction(room);
    else broadcastRoom(room);
  }
}

/* ---------------- منطق مود الجاسوس ---------------- */
function startSpyRound(room, actives) {
  const catId = room.categoryId === 'mix' ? 'sports' : room.categoryId;
  const pool = charsOf(catId);
  const fresh = pool.filter((c) => !room.usedWords.includes(c.name));
  const base = fresh.length ? fresh : pool;
  const word = base[Math.floor(Math.random() * base.length)];
  room.usedWords.push(word.name);
  room.word = word;

  const spiesCount = Math.min(room.spiesCount, Math.max(1, actives.length - 1));
  const shuffled = shuffle(actives.map((p) => p.id));
  const spyIds = shuffled.slice(0, spiesCount);

  // العميل المزدوج: شبه مدني شايف الكلمة بس شغال للجواسيس (مش جاسوس نفسه)
  let doubleAgentId = null;
  const daEnabled = room.mode === 'spy' && room.doubleAgent && actives.length >= 3;
  if (daEnabled) {
    const candidates = shuffled.filter((id) => !spyIds.includes(id));
    if (candidates.length) doubleAgentId = candidates[0];
  }

  actives.forEach((p) => {
    p.isSpy = spyIds.includes(p.id);
    p.isDoubleAgent = p.id === doubleAgentId;
    p.eliminated = false;
    p.char = { name: p.isSpy ? 'جاسوس' : word.name, emoji: p.isSpy ? '🕵️' : word.emoji };
    p.emoji = p.char.emoji;
  });
  for (const p of room.players.values()) {
    if (!actives.includes(p)) {
      p.eliminated = true;
      p.char = null;
      p.emoji = null;
      p.isSpy = false;
      p.isDoubleAgent = false;
    }
  }
  room.order = shuffle(actives.map((p) => p.id));
  room.turnIndex = 0;
  room.winnerId = null;
  room.spiesWon = null;
  room.votePrompt = false;
  room.voteResponses = {};
  room.voteOpen = false;
  room.voteTargets = [];
  room.voteMap = {};
  room.state = 'playing';
  room.chat.push({
    from: 'النظام',
    text: `🕵️ لعبة الجاسوس بدأت! الكل شايف الكلمة... إلا الجاسوس${room.spiesCount > 1 ? 'ين' : ''} (شايفين «جاسوس» بس). الكاتيجوري: ${catId === 'mix' ? 'الكورة' : (CATEGORIES.find((c) => c.id === catId) || {}).name}${daEnabled ? ' · وفي عميل مزدوج بينكم 🎭 (شكله مدني لكنه شغال للجواسيس)!' : ''}`,
    ts: Date.now(), system: true,
  });
}

function checkSpyGameOver(room) {
  const actives = activePlayers(room);
  const spies = actives.filter((p) => p.isSpy);
  const da = actives.filter((p) => p.isDoubleAgent);
  const civs = actives.filter((p) => !p.isSpy && !p.isDoubleAgent);
  if (spies.length === 0 && da.length === 0) {
    // كل الجواسيس والعملاء اتقبض عليهم — المدنيين كسبوا
    room.state = 'over';
    room.spiesWon = false;
    civs.forEach((c) => { room.points[c.id] = (room.points[c.id] || 0) + 1; });
    return true;
  }
  if (civs.length <= spies.length + da.length) {
    // فريق الجواسيس (+ العميل المزدوج) بقى أغلبية أو ساوى — كسبوا
    room.state = 'over';
    room.spiesWon = true;
    spies.forEach((s) => { room.points[s.id] = (room.points[s.id] || 0) + 3; });
    da.forEach((d) => { room.points[d.id] = (room.points[d.id] || 0) + 3; });
    return true;
  }
  return false;
}

/* ---------------- منطق لعبة «مين الكذاب؟» ---------------- */
function nextLiarQuestion(room) {
  const used = room.liar && room.liar.usedQuestions ? room.liar.usedQuestions : [];
  const fresh = LIAR_QUESTIONS.filter((q) => !used.includes(q.q));
  const pool = fresh.length >= 2 ? fresh : LIAR_QUESTIONS;
  const q1 = pool[Math.floor(Math.random() * pool.length)];
  let q2 = q1;
  while (q2 === q1) q2 = pool[Math.floor(Math.random() * pool.length)];
  return { question: q1.q, liarQuestion: q2.q, used: [...used, q1.q].slice(-40) };
}

function startLiarRound(room, actives) {
  const picked = nextLiarQuestion(room);
  const liarId = actives[Math.floor(Math.random() * actives.length)].id;
  actives.forEach((p) => {
    p.isSpy = false;
    p.isDoubleAgent = false;
    p.eliminated = false;
    p.char = null;
    p.emoji = null;
  });
  for (const p of room.players.values()) {
    if (!actives.includes(p)) { p.eliminated = true; p.char = null; p.emoji = null; p.isSpy = false; p.isDoubleAgent = false; }
  }
  room.liar = {
    phase: 'answer',       // answer | reveal | vote | over
    question: picked.question,
    liarQuestion: picked.liarQuestion,
    liarId,
    answers: {},           // playerId -> نص الإجابة
    votes: {},             // voterId -> targetId
    result: null,
    usedQuestions: picked.used,
    startedAt: Date.now(),
  };
  room.state = 'playing';
  room.winnerId = null;
  room.chat.push({
    from: 'النظام',
    text: `🤥 مين الكذاب بدأت! الكل شايف السؤال... وواحد فيكم شايف سؤال مختلف — جوابه هيبوح بيه 😏 كل واحد يكتب إجابته في السر`,
    ts: Date.now(), system: true,
  });
}

function liarAllAnswered(room) {
  return activePlayers(room).every((p) => room.liar.answers[p.id]);
}

function revealLiarAnswers(room) {
  if (!room.liar || room.liar.phase !== 'answer') return false;
  room.liar.phase = 'reveal';
  room.chat.push({ from: 'النظام', text: '📜 اتعرضت الإجابات! كل واحد يشوف إجابات الكل وشوفوا مين جوابه مش ماشي مع السؤال 🧐', ts: Date.now(), system: true });
  return true;
}

function startLiarVote(room) {
  if (!room.liar || room.liar.phase !== 'reveal') return false;
  room.liar.phase = 'vote';
  room.liar.votes = {};
  room.chat.push({ from: 'النظام', text: '🗳️ التصويت بدأ! كل واحد يصوت على اللي شاكك إنه الكذاب', ts: Date.now(), system: true });
  return true;
}

function resolveLiar(room) {
  const L = room.liar;
  if (!L || L.phase !== 'vote') return;
  const actives = activePlayers(room);
  const tally = {};
  actives.forEach((a) => {
    const t = L.votes[a.id];
    if (t) tally[t] = (tally[t] || 0) + 1;
  });
  L.phase = 'over';
  const sorted = Object.entries(tally).sort((x, y) => y[1] - x[1]);
  const noMajority = !sorted.length || (sorted.length > 1 && sorted[0][1] === sorted[1][1]);
  const accusedId = noMajority ? null : sorted[0][0];
  const accused = accusedId ? room.players.get(accusedId) : null;
  const liar = room.players.get(L.liarId);
  const isLiarCaught = accused && accused.id === L.liarId;

  if (isLiarCaught) {
    room.state = 'over';
    room.winnerId = null;
    const catchers = actives.filter((a) => L.votes[a.id] === L.liarId);
    catchers.forEach((c) => { room.points[c.id] = (room.points[c.id] || 0) + 3; });
    actives.forEach((a) => {
      if (a.id !== L.liarId && L.votes[a.id] !== L.liarId) room.points[a.id] = (room.points[a.id] || 0) + 1;
    });
    L.result = { caught: true, accusedId: L.liarId };
    room.chat.push({
      from: 'النظام',
      text: `🎉 قبضنا على الكذاب! ${liar ? liar.name : '؟'} كان شايف سؤال تاني: «${L.liarQuestion}» وجاوب «${L.answers[L.liarId] || '—'}» — إجابته فضحته!`,
      ts: Date.now(), system: true,
    });
  } else {
    // الكذاب نجا: إما اتهُّم بريء أو تعادل
    room.state = 'over';
    room.winnerId = null;
    room.points[L.liarId] = (room.points[L.liarId] || 0) + 3;
    L.result = { caught: false, accusedId };
    const victim = accused ? accused.name : null;
    room.chat.push({
      from: 'النظام',
      text: `😏 الكذاب نجا! ${liar ? liar.name : '؟'} كان شايف سؤال تاني: «${L.liarQuestion}» وجاوب «${L.answers[L.liarId] || '—'}»${victim ? ` — والناس اتهمت ${victim} بالغلط!` : ' — وما حدش اتقبض عليه (تعادل!)'}`,
      ts: Date.now(), system: true,
    });
  }
}

/* ---------------- منطق التصويت (الجاسوس) ---------------- */
function tallyVotePrompt(room) {
  const actives = activePlayers(room);
  const nowVoters = actives.filter((p) => room.voteResponses[p.id] === 'now');
  const laterVoters = actives.length - nowVoters.length;
  room.votePrompt = false;
  room.voteResponses = {};
  if (nowVoters.length > laterVoters) {
    room.voteOpen = true;
    room.voteTargets = actives.map((p) => p.id);
    room.voteMap = {};
    room.chat.push({ from: 'النظام', text: '🗳️ التصويت على الجاسوس بدأ! كل واحد يختار مين شاكك فيه — بالأغلبية 🎯', ts: Date.now(), system: true });
  } else {
    room.chat.push({ from: 'النظام', text: '📉 الأغلبية اختارت الاستمرار — الجولة بتكمّل 😤', ts: Date.now(), system: true });
  }
}

function resolveVote(room) {
  const actives = activePlayers(room);
  const voteMap = { ...room.voteMap }; // صورة ثابتة قبل المسح
  const tally = {};
  actives.forEach((a) => {
    const t = voteMap[a.id];
    if (t) tally[t] = (tally[t] || 0) + 1;
  });
  room.voteOpen = false;
  room.voteTargets = [];
  room.voteMap = {};
  const sorted = Object.entries(tally).sort((x, y) => y[1] - x[1]);
  if (!sorted.length || (sorted.length > 1 && sorted[0][1] === sorted[1][1])) {
    room.chat.push({ from: 'النظام', text: '😅 التصويت اتعادل — ما حدش اتقبض، نكمّل اللعب', ts: Date.now(), system: true });
    broadcastRoom(room);
    return;
  }
  const accused = room.players.get(sorted[0][0]);
  if (!accused) return;
  if (accused.isSpy) {
    room.state = 'over';
    room.spiesWon = false;
    const catchers = actives.filter((a) => voteMap[a.id] === accused.id);
    catchers.forEach((c) => { room.points[c.id] = (room.points[c.id] || 0) + 3; });
    actives.forEach((a) => {
      if (a.id !== accused.id && voteMap[a.id] !== accused.id && !a.isDoubleAgent) room.points[a.id] = (room.points[a.id] || 0) + 1;
    });
    room.chat.push({
      from: 'النظام',
      text: `🎉 التصويت قبض على الجاسوس! ${accused.name} كان ${accused.emoji} جاسوس 🕵️ (الكلمة كانت: ${room.word.emoji} ${room.word.name})`,
      ts: Date.now(), system: true,
    });
    broadcastRoom(room);
    return;
  }
  const wrongVoters = actives.filter((a) => voteMap[a.id] === accused.id);
  wrongVoters.forEach((a) => { a.eliminated = true; });
  room.chat.push({
    from: 'النظام',
    text: `😅 الأغلبية اتهجمت على ${accused.name} وطلع ${accused.isDoubleAgent ? 'عميل مزدوج! 🎭' : 'مدني!'} ${wrongVoters.map((v) => v.name).join(' و') || 'اللي صوتوا عليه'} اتقبضوا بدل الجاسوس`,
    ts: Date.now(), system: true,
  });
  if (!checkSpyGameOver(room)) nextTurn(room);
  broadcastRoom(room);
}

/* ---------------- منطق مود التخمين ---------------- */
function startGuessRound(room, actives, pool) {
  actives.forEach((p, i) => {
    p.isSpy = false;
    p.isDoubleAgent = false;
    p.char = pool[i];
    p.charProfile = PLAYER_BY_NAME[pool[i].name] || null; // بروفايل اللاعب (للاعبين الحقيقيين)
    p.emoji = pool[i].emoji;
    p.eliminated = false;
  });
  for (const p of room.players.values()) {
    if (!actives.includes(p)) {
      p.eliminated = true;
      p.char = null;
      p.charProfile = null;
      p.emoji = null;
      p.isSpy = false;
      p.isDoubleAgent = false;
    }
  }
  room.order = shuffle(actives.map((p) => p.id));
  room.turnIndex = 0;
  room.winnerId = null;
  room.spiesWon = null;
  room.state = 'playing';
}

const excludeNamesOf = (room) => [...room.players.values()].map((p) => (p.char ? p.char.name : '')).filter(Boolean);

function attemptStart(room, data, ack) {
  const actives = [...room.players.values()].filter((p) => p.connected);
  if (actives.length < 2) {
    ack && ack({ ok: false, error: 'محتاجين على الأقل 2 لاعبين للعب 👥' });
    return false;
  }
  if (room.mode === 'auction') {
    if (actives.length < 2) {
      ack && ack({ ok: false, error: 'المزاد محتاج 2 لاعبين على الأقل 🔨' });
      return false;
    }
    const s = Number(data && data.squadSize);
    if (s === 11 || s === 5) room.squadSize = s;
    startAuction(room, actives);
    return true;
  }
  if (room.mode === 'spy') {
    if (actives.length < 3) {
      ack && ack({ ok: false, error: 'لعبة الجاسوس محتاجة 3 لاعبين على الأقل 🕵️' });
      return false;
    }
    startSpyRound(room, actives);
    return true;
  }
  if (room.mode === 'liar') {
    if (actives.length < 3) {
      ack && ack({ ok: false, error: 'لعبة مين الكذاب محتاجة 3 لاعبين على الأقل 🤥' });
      return false;
    }
    startLiarRound(room, actives);
    return true;
  }
  const pool = pickCharacters(actives.length, room.categoryId, excludeNamesOf(room), room.difficulty);
  if (pool.length < actives.length) {
    ack && ack({ ok: false, error: 'الكاتيجوري دي مش فيها شخصيات كفاية للعدد ده، جرب كاتيجوري تاني 😐' });
    return false;
  }
  startGuessRound(room, actives, pool);
  room.chat.push({
    from: 'النظام',
    text: room.categoryId === 'sports' && room.difficulty !== 'all'
      ? `🎭 التخمين بدأ! الكورة بسهولة «${DIFF_NAMES[room.difficulty]}» — كل واحد شايف شخصيته ويسألوا بعض بنعم/لا`
      : '🎭 التخمين بدأ! كل واحد شايف شخصيته السرية ويسألوا بعض بنعم/لا',
    ts: Date.now(), system: true,
  });
  return true;
}

/* ---------------- عرض الحالة ---------------- */
function auctionView(room, socketId) {
  const a = room.auction;
  if (!a) return null;
  const card = currentCard(room);
  const view = {
    phase: a.phase,
    cardIndex: a.cardIndex,
    deckLength: a.deck.length,
    card: card ? { n: card.n, r: card.r, pos: card.pos, t: card.t, c: card.c, num: card.num, e: card.e } : null,
    currentBid: a.currentBid,
    startBid: card ? cardBase(card) : 0,
    remainingBidders: a.bidders.length,
    iAmBidder: a.bidders.includes(socketId),
    bidTurnId: a.phase === 'bidding' && a.bidders.length ? a.bidders[a.bidTurn % a.bidders.length] : null,
    myBudget: a.budgets[socketId],
    myTeam: a.teams[socketId] || [],
    teams: a.teams,
    stealTurnId: a.phase === 'steal' && a.stealOrder.length ? a.stealOrder[a.stealTurn] : null,
    stealUsed: a.stealUsed,
    canSteal: a.phase === 'steal' ? (a.stealOrder[a.stealTurn] === socketId && !a.stealUsed[socketId]) : false,
  };
  return view;
}

function viewChar(p) {
  if (!p.char) return null;
  const c = p.char;
  const prof = p.charProfile || null;
  const v = { name: c.name, emoji: c.emoji, isSpy: p.isSpy, isDoubleAgent: p.isDoubleAgent };
  const img = charImageOf(c.name, prof);
  if (img) v.img = img;
  if (prof) {
    v.isPlayer = true;
    v.cc = jerseyColorOf(prof.t);
    v.profile = prof; // كل الحقول: n,e,t,c,p,num,champs,ach,prev,r,pos,v
  } else {
    const bio = CHAR_BIO[c.name];
    if (bio) v.bio = bio;
  }
  return v;
}

function sanitize(room, socketId) {
  const me = room.players.get(socketId);
  const revealAll = room.state === 'over';
  const isAuction = room.mode === 'auction';
  const players = [...room.players.values()].map((p) => ({
    id: p.id,
    name: p.name,
    connected: p.connected,
    eliminated: p.eliminated,
    isMe: p.id === socketId,
    char: (revealAll || p.id === socketId) ? viewChar(p) : null,
  }));
  const actives = activePlayers(room);
  // عرض لعبة «مين الكذاب؟» للاعب محدد
  let liarView = null;
  if (room.mode === 'liar' && room.liar) {
    const L = room.liar;
    const me = room.players.get(socketId);
    const isLiar = L.liarId === socketId;
    liarView = {
      phase: L.phase,
      question: isLiar ? L.liarQuestion : L.question,
      myAnswer: L.answers[socketId] || null,
      iAmLiar: isLiar,
      answeredCount: Object.keys(L.answers).length,
      total: actives.length,
      answers: L.phase === 'answer' ? null : activePlayers(room).map((p) => ({
        id: p.id, name: p.name, text: L.answers[p.id] || '—', isMine: p.id === socketId,
      })),
      targets: L.phase === 'vote' ? activePlayers(room).filter((p) => p.id !== socketId).map((p) => ({ id: p.id, name: p.name })) : null,
      myVote: L.votes[socketId] || null,
      votesCast: Object.keys(L.votes).length,
      reveal: L.phase === 'over' ? {
        question: L.question,
        liarQuestion: L.liarQuestion,
        liarId: L.liarId,
        liarName: (room.players.get(L.liarId) || {}).name,
        liarAnswer: L.answers[L.liarId] || null,
        caught: L.result ? L.result.caught : false,
      } : null,
    };
  }
  return {
    code: room.code,
    host: room.host,
    state: room.state,
    mode: room.mode,
    version: PROTOCOL_VERSION,
    categoryId: room.categoryId,
    difficulty: room.difficulty,
    categories: CATEGORY_INFO,
    players,
    chat: room.chat.slice(-60),
    turnId: room.state === 'playing' && !isAuction ? room.order[room.turnIndex] : null,
    winnerId: room.winnerId,
    spiesCount: room.spiesCount,
    doubleAgent: room.doubleAgent,
    spiesWon: room.spiesWon,
    word: room.mode === 'spy' && room.state === 'over' ? room.word : null,
    myId: socketId,
    hostIP: socketId === room.host ? room.lanIP : undefined,
    hostURL: socketId === room.host ? room.publicURL : undefined,
    points: room.points,
    squadSize: room.squadSize,
    // التصويت (الجاسوس)
    votePrompt: room.votePrompt,
    myVoteResponse: room.votePrompt ? (room.voteResponses[socketId] || null) : null,
    voteResponded: room.votePrompt ? actives.filter((p) => room.voteResponses[p.id]).length : 0,
    voteTotal: room.votePrompt ? actives.length : 0,
    voteOpen: room.voteOpen,
    voteTargets: room.voteOpen ? room.voteTargets : [],
    myVote: room.voteOpen ? (room.voteMap[socketId] || null) : null,
    voteCast: room.voteOpen ? actives.filter((p) => room.voteMap[p.id]).length : 0,
    // المزاد
    auction: isAuction ? auctionView(room, socketId) : null,
    auctionResult: isAuction && room.state === 'over' ? room.auctionResult : null,
    liar: liarView,
  };
}

function broadcastRoom(room) {
  for (const id of room.players.keys()) {
    io.to(id).emit('state', sanitize(room, id));
  }
}

function nextTurn(room) {
  const actives = activePlayers(room);
  if (actives.length <= 1) return;
  const activeIds = actives.map((p) => p.id);
  let i = (room.turnIndex + 1) % room.order.length;
  for (let s = 0; s < room.order.length; s++) {
    const candidateId = room.order[i];
    const candidate = room.players.get(candidateId);
    if (candidate && activeIds.includes(candidateId)) {
      room.turnIndex = i;
      return;
    }
    i = (i + 1) % room.order.length;
  }
}

function checkGameOver(room) {
  const actives = activePlayers(room);
  if (actives.length === 1) {
    room.state = 'over';
    room.winnerId = actives[0].id;
    if (actives.length > 0) room.points[actives[0].id] = (room.points[actives[0].id] || 0) + 3;
    return true;
  }
  return false;
}

/* ------------------------- أحداث Socket.io ------------------------- */
io.on('connection', (socket) => {
  // إنشاء أوضة
  socket.on('create-room', (data, ack) => {
    const v = Number(data && data.v);
    if (!v || v < PROTOCOL_VERSION) {
      ack && ack({ ok: false, error: VERSION_MESSAGE });
      return;
    }
    const name = (data && data.name || '').trim().slice(0, 20) || 'لاعب';
    const mode = data && data.mode;
    const room = createRoom(socket, name, mode);
    ack && ack({ ok: true, code: room.code, mode: room.mode });
    broadcastRoom(room);
  });

  // الانضمام لأوضة
  socket.on('join-room', (data, ack) => {
    const v = Number(data && data.v);
    if (!v || v < PROTOCOL_VERSION) {
      ack && ack({ ok: false, error: VERSION_MESSAGE });
      return;
    }
    const code = String(data && data.code || '').trim().toUpperCase();
    const name = (data && data.name || '').trim().slice(0, 20) || 'لاعب';
    const room = rooms.get(code);
    if (!room) {
      ack && ack({ ok: false, error: 'الكود غلط يا حيوان 🐒😄' });
      return;
    }
    if (room.players.has(socket.id)) {
      ack && ack({ ok: false, error: 'إنت داخل بالفعل' });
      return;
    }
    if (room.state === 'playing') {
      ack && ack({ ok: false, error: 'اللعبة بدأت خلاص... استنى الجولة الجاية 😅' });
      return;
    }
    addPlayer(room, socket, name);
    ack && ack({ ok: true, code: room.code });
    broadcastRoom(room);
  });

  // تحديد الكاتيجوري (صاحب الأوضة)
  socket.on('set-category', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room || room.host !== socket.id) return;
    const id = String(data && data.categoryId || '').trim();
    if (id === 'mix' || CATEGORIES.some((c) => c.id === id)) {
      room.categoryId = id;
    }
    broadcastRoom(room);
    ack && ack({ ok: true });
  });

  // مستوى صعوبة لعيبة الكورة (صاحب الأوضة — للتخمين)
  socket.on('set-difficulty', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room) { ack && ack({ ok: false, error: 'مش في أوضة' }); return; }
    if (room.host !== socket.id) { ack && ack({ ok: false, error: 'صاحب الأوضة بس هو اللي يحدد الصعوبة' }); return; }
    const d = String(data && data.difficulty || '').trim();
    if (isDiff(d)) {
      room.difficulty = d;
      broadcastRoom(room);
      ack && ack({ ok: true });
    } else {
      ack && ack({ ok: false, error: 'صعوبة غير معروفة' });
    }
  });

  // تحديد عدد الجواسيس (صاحب الأوضة)
  socket.on('set-spy-count', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room || room.host !== socket.id) return;
    const n = Number(data && data.count);
    if (n === 1 || n === 2) room.spiesCount = n;
    broadcastRoom(room);
    ack && ack({ ok: true });
  });

  // تفعيل/إيقاف العميل المزدوج في الجاسوس (صاحب الأوضة)
  socket.on('set-double-agent', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room || room.host !== socket.id) return;
    room.doubleAgent = !!data && !!data.on;
    broadcastRoom(room);
    ack && ack({ ok: true });
  });

  // تحديد حجم التشكيلة في المزاد (صاحب الأوضة)
  socket.on('set-squad-size', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room || room.host !== socket.id) return;
    const s = Number(data && data.size);
    if (s === 5 || s === 11) room.squadSize = s;
    broadcastRoom(room);
    ack && ack({ ok: true });
  });

  // بدء اللعب (صاحب الأوضة بس)
  socket.on('start-game', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room) return;
    if (room.host !== socket.id) return;
    if (attemptStart(room, data, ack)) {
      ack && ack({ ok: true });
      broadcastRoom(room);
    }
  });

  // إرسال رسالة في الشات
  socket.on('chat', (data) => {
    const room = findRoomOf(socket.id);
    if (!room) return;
    const p = room.players.get(socket.id);
    const text = String(data && data.text || '').trim().slice(0, 300);
    if (!text) return;
    room.chat.push({ from: p.name, text, ts: Date.now() });
    broadcastRoom(room);
  });

  // ميديا في الشات (Feature 2): صورة / صوت / فيديو — DataURL مع حدود للحجم
  const MEDIA_LIMITS = { image: 700000, audio: 1500000, video: 3000000 };
  socket.on('chat-media', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room) { ack && ack({ ok: false, error: 'مش في أوضة' }); return; }
    const p = room.players.get(socket.id);
    const media = (data && data.media) || null;
    const type = media && String(media.type || '');
    const raw = String(media && media.data || '');
    const cap = MEDIA_LIMITS[type];
    if (!cap) { ack && ack({ ok: false, error: 'النوع غير مدعوم' }); return; }
    if (!raw || !raw.startsWith('data:') || raw.length > cap) {
      ack && ack({ ok: false, error: 'الملف كبير أو فاضي' });
      return;
    }
    room.chat.push({ from: p.name, ts: Date.now(), media: { type, data: raw } });
    broadcastRoom(room);
    ack && ack({ ok: true });
  });

  // طلب تصويت عاجل (صاحب الأوضة - مود الجاسوس أثناء اللعب)
  socket.on('request-vote', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room || room.mode !== 'spy' || room.state !== 'playing') { ack && ack({ ok: false }); return; }
    if (room.host !== socket.id) { ack && ack({ ok: false }); return; }
    if (room.votePrompt || room.voteOpen) { ack && ack({ ok: false }); return; }
    room.votePrompt = true;
    room.voteResponses = { [socket.id]: 'now' }; // صاحب الأوضة مع «تصويت الآن» على طول
    room.chat.push({ from: 'النظام', text: '🗳️ صاحب الأوضة طلب تصويت على الجاسوس! الكل يقرر: تصويت دلوقتي ولا نكمل؟', ts: Date.now(), system: true });
    broadcastRoom(room);
    ack && ack({ ok: true });
  });

  // رد على طلب التصويت
  socket.on('vote-response', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room || room.mode !== 'spy' || room.state !== 'playing' || !room.votePrompt) { ack && ack({ ok: false }); return; }
    const me = room.players.get(socket.id);
    if (!me || me.eliminated) { ack && ack({ ok: false }); return; }
    if (room.host === socket.id) { ack && ack({ ok: false }); return; } // صاحب الأوضة محسوب على طول
    room.voteResponses[socket.id] = data && data.now ? 'now' : 'later';
    const actives = activePlayers(room);
    if (actives.every((p) => room.voteResponses[p.id])) tallyVotePrompt(room);
    broadcastRoom(room);
    ack && ack({ ok: true });
  });

  // إلغاء طلب التصويت (صاحب الأوضة)
  socket.on('cancel-vote', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room || room.host !== socket.id) { ack && ack({ ok: false }); return; }
    room.votePrompt = false;
    room.voteResponses = {};
    room.voteOpen = false;
    room.voteMap = {};
    room.chat.push({ from: 'النظام', text: '🚫 صاحب الأوضة ألغى التصويت', ts: Date.now(), system: true });
    broadcastRoom(room);
    ack && ack({ ok: true });
  });

  // التصويت على الجاسوس
  socket.on('vote-cast', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room || room.mode !== 'spy' || !room.voteOpen) return;
    const me = room.players.get(socket.id);
    if (!me || me.eliminated) return;
    const targetId = data && data.targetId;
    if (!targetId || targetId === socket.id || !room.players.has(targetId)) return;
    const target = room.players.get(targetId);
    if (!target || target.eliminated || !target.connected) return;
    room.voteMap[socket.id] = targetId;
    const actives = activePlayers(room);
    if (actives.every((p) => room.voteMap[p.id])) resolveVote(room);
    else broadcastRoom(room);
    ack && ack({ ok: true });
  });

  // إرسال إجابة في لعبة «مين الكذاب؟»
  socket.on('liar-answer', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room || room.mode !== 'liar' || room.state !== 'playing' || !room.liar) { ack && ack({ ok: false }); return; }
    const me = room.players.get(socket.id);
    if (!me || me.eliminated) { ack && ack({ ok: false }); return; }
    if (room.liar.phase !== 'answer') { ack && ack({ ok: false, error: 'الإجابات اتعرضت خلاص' }); return; }
    const text = String(data && data.text || '').trim().slice(0, 120);
    if (!text) { ack && ack({ ok: false, error: 'اكتب إجابة الأول' }); return; }
    room.liar.answers[socket.id] = text;
    if (liarAllAnswered(room)) revealLiarAnswers(room);
    broadcastRoom(room);
    ack && ack({ ok: true });
  });

  // صاحب الأوضة يبدأ التصويت بعد مرحلة الكشف
  socket.on('liar-start-vote', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room || room.mode !== 'liar' || room.host !== socket.id) { ack && ack({ ok: false }); return; }
    if (!startLiarVote(room)) { ack && ack({ ok: false, error: 'مش في مرحلة الكشف' }); return; }
    broadcastRoom(room);
    ack && ack({ ok: true });
  });

  // التصويت على الكذاب
  socket.on('liar-cast-vote', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room || room.mode !== 'liar' || !room.liar || room.liar.phase !== 'vote') { ack && ack({ ok: false }); return; }
    const me = room.players.get(socket.id);
    if (!me || me.eliminated) { ack && ack({ ok: false }); return; }
    const targetId = data && data.targetId;
    if (!targetId || targetId === socket.id || !room.players.has(targetId)) { ack && ack({ ok: false, error: 'هدف غير صالح' }); return; }
    const target = room.players.get(targetId);
    if (!target || target.eliminated || !target.connected) { ack && ack({ ok: false }); return; }
    room.liar.votes[socket.id] = targetId;
    const actives = activePlayers(room);
    if (actives.every((p) => room.liar.votes[p.id])) resolveLiar(room);
    broadcastRoom(room);
    ack && ack({ ok: true });
  });

  // التخمين / الاتهام بالجاسوسية
  socket.on('make-guess', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room || room.state !== 'playing' || room.mode === 'auction' || room.mode === 'liar') return;
    const me = room.players.get(socket.id);
    if (!me || me.eliminated) return;
    const targetId = data && data.targetId;
    const guess = String(data && data.guess || '').trim().slice(0, 60);
    if (!targetId) return;
    const target = room.players.get(targetId);
    if (!target || target === me || target.eliminated || !target.connected || !target.char) return;

    // مود الجاسوس: اتهام
    if (room.mode === 'spy') {
      if (target.isSpy) {
        room.state = 'over';
        room.spiesWon = false;
        room.points[me.id] = (room.points[me.id] || 0) + 3;
        activePlayers(room).forEach((a) => { if (a.id !== me.id && !a.isSpy && !a.isDoubleAgent) room.points[a.id] = (room.points[a.id] || 0) + 1; });
        room.chat.push({
          from: 'النظام',
          text: `🎉 ${me.name} قبض على الجاسوس! ${target.name} كان ${target.emoji} جاسوس 🕵️ (الكلمة كانت: ${room.word.emoji} ${room.word.name})`,
          ts: Date.now(), system: true,
        });
      } else {
        me.eliminated = true;
        room.chat.push({
          from: 'النظام',
          text: `😅 ${me.name} اتهم ${target.name} بالغلط — ${target.name} ${target.isDoubleAgent ? 'عميل مزدوج! 🎭' : 'مدني طبيعي!'} ${me.name} اتقبض عليه بدل الجاسوس`,
          ts: Date.now(), system: true,
        });
        if (!checkSpyGameOver(room)) nextTurn(room);
      }
      broadcastRoom(room);
      ack && ack({ ok: true });
      return;
    }

    // مود التخمين: تخمين شخصية
    if (!guess) return;
    const correct = normalize(guess) === normalize(target.char.name);
    let extra = '';
    if (correct) {
      target.eliminated = true;
      extra = `🎉 صح! ${me.name} عرف إن ${target.name} هو ${target.char.emoji} ${target.char.name}`;
    } else {
      me.eliminated = true;
      extra = `❌ غلط! ${me.name} خمّن غلط واتخرج من الجولة (الشخصية الصح كانت ${target.char.emoji} ${target.char.name})`;
    }
    room.chat.push({ from: 'النظام', text: extra, ts: Date.now(), system: true });
    checkGameOver(room);
    if (room.state === 'playing') nextTurn(room);
    broadcastRoom(room);
    ack && ack({ ok: true });
  });

  // تمرير الدور (مود التخمين والجاسوس)
  socket.on('pass-turn', () => {
    const room = findRoomOf(socket.id);
    if (!room || room.state !== 'playing' || room.mode === 'auction' || room.mode === 'liar') return;
    const currentId = room.order[room.turnIndex];
    if (currentId !== socket.id) return;
    nextTurn(room);
    broadcastRoom(room);
  });

  /* ---- أحداث المزاد ---- */
  socket.on('auction-act', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room || room.mode !== 'auction' || room.state !== 'playing') return;
    const a = room.auction;
    if (!a || a.phase !== 'bidding') return;
    if (a.cardIndex >= a.deck.length) return;
    const card = currentCard(room);
    const me = room.players.get(socket.id);
    if (!me || me.eliminated) return;
    if (a.bidders[a.bidTurn % a.bidders.length] !== socket.id) { ack && ack({ ok: false, error: 'مش دورك في المزايدة 🤨' }); return; }
    if (!a.bidders.includes(socket.id)) return;

    const action = data && data.action; // buy | raise | pass
    if (action === 'buy') {
      const price = a.currentBid;
      if (price <= 0 || a.budgets[socket.id] < price) { ack && ack({ ok: false, error: 'معندكش فلوس كفاية 😐' }); return; }
      sellCardTo(room, socket.id, price, false);
      broadcastRoom(room);
      ack && ack({ ok: true });
      return;
    }
    if (action === 'raise') {
      const add = [1, 5, 10].includes(Number(data.amount)) ? Number(data.amount) : 1;
      const next = a.currentBid + add;
      if (a.budgets[socket.id] < next) { ack && ack({ ok: false, error: 'الفلوس مش كفاية للزيادة دي 😐' }); return; }
      a.currentBid = next;
      room.chat.push({ from: 'النظام', text: `💸 ${me.name} زايد على ${POS_EMOJI[card.pos]} ${card.n} إلى ${next} مليون`, ts: Date.now(), system: true });
      nextAuctionTurn(room);
      broadcastRoom(room);
      ack && ack({ ok: true });
      return;
    }
    if (action === 'pass') {
      room.chat.push({ from: 'النظام', text: `⏭️ ${me.name} خرج من المزايدة على ${POS_EMOJI[card.pos]} ${card.n}`, ts: Date.now(), system: true });
      a.bidders = a.bidders.filter((id) => id !== socket.id);
      if (!a.bidders.length) {
        sellCardTo(room, null, 0, true);
      } else if (a.bidders.length === 1) {
        sellCardTo(room, a.bidders[0], a.currentBid, false);
      } else {
        if (a.bidTurn >= a.bidders.length) a.bidTurn = 0;
        broadcastRoom(room);
      }
      ack && ack({ ok: true });
      return;
    }
  });

  // الخطف خلال مرحلة الخطف
  socket.on('steal-act', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room || room.mode !== 'auction' || room.state !== 'playing') return;
    stealAction(room, socket, data, ack);
  });

  // جولة جديدة (صاحب الأوضة)
  socket.on('next-round', (data, ack) => {
    const room = findRoomOf(socket.id);
    if (!room) return;
    if (room.host !== socket.id) return;
    if (room.mode === 'auction') {
      // عشان ما نحسبش نقاط جولة قديمة مرتين: نحسبها مرة واحدة عند endAuction
      room.auction = null;
      room.auctionResult = null;
      if (attemptStart(room, data, ack)) {
        ack && ack({ ok: true });
        broadcastRoom(room);
      }
      return;
    }
    if (attemptStart(room, data, ack)) {
      ack && ack({ ok: true });
      broadcastRoom(room);
    }
  });

  // ترك الأوضة
  socket.on('leave-room', () => {
    handleLeave(socket);
  });

  socket.on('disconnect', () => {
    handleLeave(socket);
  });
});

function handleLeave(socket) {
  const room = findRoomOf(socket.id);
  if (!room) return;
  const p = room.players.get(socket.id);
  const name = p ? p.name : 'لاعب';
  const leftWasSpy = p ? p.isSpy : false;
  const wasHost = room.host === socket.id;
  room.players.delete(socket.id);
  delete room.voteResponses[socket.id];
  delete room.voteMap[socket.id];

  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }

  // لو صاحب الأوضة ساب، نختار حد تاني
  if (wasHost) {
    const next = [...room.players.keys()][0];
    room.host = next;
  }

  room.chat.push({ from: 'النظام', text: `👋 ${name} ساب الأوضة`, ts: Date.now(), system: true });

  if (room.state === 'over') {
    broadcastRoom(room);
    return;
  }

  if (room.state === 'playing' && room.mode === 'auction') {
    if (activePlayers(room).length >= 2) {
      handleAuctionLeave(room, socket.id);
    } else {
      endAuction(room);
    }
    broadcastRoom(room);
    return;
  }

  if (room.state === 'playing') {
    if (room.mode === 'liar') {
      // حد ساب أثناء «مين الكذاب؟»: لو الكذاب نفسه ساب — الكل يحسب أنه اتقبض؟
      const L = room.liar;
      if (L) {
        if (L.liarId === socket.id && L.phase !== 'over') {
          // الكذاب ساب وشخصيته بانت — ننهي الجولة
          L.phase = 'over';
          room.state = 'over';
          room.chat.push({ from: 'النظام', text: `😱 ${name} كان الكذاب وساب الأوضة! الباقيين كسبوا`, ts: Date.now(), system: true });
          activePlayers(room).forEach((a) => { room.points[a.id] = (room.points[a.id] || 0) + 3; });
          broadcastRoom(room);
          return;
        }
        if (L.phase === 'answer') {
          // حد ساب أثناء الإجابات: لو كملنا نقدر نعرض المتاح
          const actives = activePlayers(room);
          if (actives.length >= 2 && actives.every((p) => L.answers[p.id])) revealLiarAnswers(room);
        }
      }
      broadcastRoom(room);
      return;
    }
    if (room.mode === 'spy') {
      if (room.votePrompt) {
        // حد راح أثناء طلب التصويت: لو الكل رد + الباقي، نجمّع
        const actives = activePlayers(room);
        if (actives.some((p) => p.id === room.host) && actives.every((p) => room.voteResponses[p.id])) tallyVotePrompt(room);
      }
      if (leftWasSpy) {
        room.state = 'over';
        room.spiesWon = false;
        room.chat.push({ from: 'النظام', text: `😱 ${name} كان الجاسوس وساب الأوضة! المدنيين كسبوا`, ts: Date.now(), system: true });
      } else if (p && p.isDoubleAgent) {
        room.chat.push({ from: 'النظام', text: `🎭 ${name} كان العميل المزدوج وساب الأوضة!`, ts: Date.now(), system: true });
        if (!checkSpyGameOver(room)) {
          const currentId = room.order[room.turnIndex];
          if (!currentId || !room.players.get(currentId)) nextTurn(room);
        }
      } else if (!checkSpyGameOver(room)) {
        const currentId = room.order[room.turnIndex];
        if (!currentId || !room.players.get(currentId)) nextTurn(room);
      }
    } else {
      checkGameOver(room);
      if (room.state === 'playing') {
        const currentId = room.order[room.turnIndex];
        if (!currentId || !room.players.get(currentId)) nextTurn(room);
      }
    }
  }
  broadcastRoom(room);
}

/* ------------------------- السيرفر ------------------------- */
// منع الكاش نهائيًا — دائمًا نخدم آخر نسخة من الواجهة (مهم بعد التحديثات)
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

server.listen(PORT, '0.0.0.0', () => {
  const ips = getLanIPs();
  console.log('===========================================');
  console.log('   🃏 كرت فكة! السيرفر شغال (v3)');
  console.log('   مودات: تخمين 🎭 | جاسوس 🕵️ (تصويت) | مزاد النجوم 🔨');
  console.log(' ----------------------------------------- ');
  console.log('   افتح على جهازك:');
  console.log(`   http://localhost:${PORT}`);
  if (ips.length) {
    console.log('   اللعيبة (نفس الشبكة) يفتحوا:');
    ips.forEach((ip) => console.log(`   http://${ip}:${PORT}`));
  }
  console.log('===========================================');
});