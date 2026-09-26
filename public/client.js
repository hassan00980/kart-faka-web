/* ===== كرت فكة - منطق الواجهة ===== */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const socket = io();

  let state = null; // آخر حالة وصلت من السيرفر
  let myName = localStorage.getItem('khammeni_name') || '';
  let mode = 'guess'; // guess | spy | auction — المود اللي هيتعمل بيه الأوضة

  /* نسخة البروتوكول — لازم تطابق سيرفر الـ PROTOCOL_VERSION (6) */
  const PROTOCOL_VERSION = 6;

  /* ---------------- الإعدادات (Settings) ---------------- */
  const SETTINGS_KEY = 'khammeni_settings';
  function defaultSettings() {
    return { sound: true, music: true, vibrate: true, anim: true, dark: false, lang: 'ar', font: 100 };
  }
  function loadSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
      return Object.assign(defaultSettings(), saved || {});
    } catch (e) { return defaultSettings(); }
  }
  let settings = loadSettings();
  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  // قاموس الترجمة للعناصر الثابتة (اللعبة الأصلية عربي، والترجمة للعناصر الرئيسية)
  const I18N = {
    en: {
      app_title: 'Kart Faka!',
      tagline: 'Gather around the table and pick tonight\'s game',
      mode_guess: '🎭 Guess',
      mode_spy: '🕵️ Spy',
      mode_liar: '🤥 Who\'s the Liar?',
      mode_auction: '🔨 Auction',
      hint_guess: 'Everyone gets a secret character from the same category, and we take turns asking questions until we figure each other out 🕵️',
      hint_spy: 'Everyone sees the secret word... except the spies. Find the spy by asking questions! 🕵️',
      hint_liar: 'Everyone answers the same question secretly... except the liar who sees a different question and tries to blend in 🤥',
      hint_auction: 'Bid on star players with a budget, then steal from rivals. Build the best squad to win! 🔨',
      create_room: '🆕 Create Room',
      join_room: '🚪 Join Room',
      join_placeholder: 'Room code',
      name_placeholder: 'Type your name here...',
      settings: '⚙️ Settings',
      sound: '🔊 Sound',
      music: '🎵 Music',
      vibrate: '📳 Vibration',
      anim: '✨ Animation',
      dark: '🌙 Dark Mode',
      lang_label: '🌐 Language',
      font_label: '🔤 Font Size',
    },
  };

  function applySettings() {
    const s = settings;
    document.body.classList.toggle('dark', s.dark);
    document.body.classList.toggle('no-anim', !s.anim);
    document.documentElement.style.setProperty('--font-scale', (s.font / 100));
    document.documentElement.setAttribute('lang', s.lang === 'en' ? 'en' : 'ar');
    document.documentElement.setAttribute('dir', s.lang === 'en' ? 'ltr' : 'rtl');
    const t = $('set-font-val');
    if (t) t.textContent = s.font + '%';
    const strs = {};
    const d = (s.lang === 'en' ? I18N.en : {});
    const _ = (k, fallback) => d[k] || fallback;
    const el = (id, txt) => { const n = $(id); if (n) n.textContent = txt; };
    el('app-title', _('app_title', 'كرت فكة'));
    el('app-tagline', _('tagline', 'اجمعوا حول الطاولة، واختاروا اللعبة اللي تبدأوا بيها الليلة'));
    el('mode-guess', _('mode_guess', '🎭 تخمين'));
    el('mode-spy', _('mode_spy', '🕵️ جاسوس'));
    el('mode-liar', _('mode_liar', '🤥 مين الكذاب؟'));
    el('mode-auction', _('mode_auction', '🔨 مزاد'));
    el('btn-create', _('create_room', '🆕 اعمل أوضة جديدة'));
    el('btn-join', _('join_room', '🚪 انضم لأوضة'));
    const ni = $('inp-name'); if (ni) ni.placeholder = _('name_placeholder', 'اكتب اسمك هنا...');
    const ji = $('inp-join-code'); if (ji) ji.placeholder = _('join_placeholder', 'كود الأوضة');
    const hintMap = { guess: 'hint_guess', spy: 'hint_spy', liar: 'hint_liar', auction: 'hint_auction' };
    const hk = hintMap[mode] || 'hint_guess';
    el('mode-hint', _(
      hk,
      hk === 'hint_spy' ? 'الكل شايف الكلمة السرية... إلا الجواسيس! اسألوا في بعض لحد ما تلاقوا الجاسوس 🕵️' :
      hk === 'hint_liar' ? 'الكل يشوف سؤال وكل واحد يجاوب في السر... وواحد فيكم شايف سؤال مختلف ويحاول يتمثل 🤥' :
      hk === 'hint_auction' ? 'زود على النجوم بميزانية محدودة، واختطف تشكيلات المنافسين — اجمع أقوى تشكيلة 🔨' :
      'كل واحد ياخد شخصية سرية من نفس الكاتيجوري، ونتناوب الأسئلة لحد ما نكشف بعض 🕵️'
    ));
  }

  function vibrate(ms) {
    if (settings.vibrate && navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (e) { /* غير مدعوم */ }
    }
  }

  /* ================= Sound Design 🎧 =================
     أصوات مولّدة بالكود عبر Web Audio API — من غير ملفات خارجية
     بتشتغل على الويب والأندرويد معًا (نفس client.js) */
  let audioCtx = null;
  let musicTimer = null;
  let musicStep = 0;
  function ensureAudio() {
    if (!settings.sound) return null;
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        audioCtx = new AC();
      }
      if (audioCtx.state === 'suspended') audioCtx.resume();
      return audioCtx;
    } catch (e) { return null; }
  }
  // موسيقى خلفية خفيفة (مولّدة) — loop هادي على النغمات
  const MUSIC_GENRES = [
    [220.0, 277.18, 329.63], // A-major وتر
    [196.0, 246.94, 293.66], // G-major وتر
    [174.61, 220.0, 261.63], // F-major وتر
  ];
  function startMusic() {
    if (musicTimer) return;
    const ctx = ensureAudio();
    if (!ctx || !settings.music) return;
    musicStep = 0;
    musicTimer = setInterval(() => {
      if (!settings.music || !audioCtx) return;
      const chord = MUSIC_GENRES[musicStep % MUSIC_GENRES.length];
      chord.forEach((f, i) => tone(audioCtx, f, 1.6, 'sine', 0.045, i * 0.08));
      musicStep++;
    }, 2400);
  }
  function stopMusic() {
    if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
  }
  function tone(ctx, freq, dur, type, vol, delay) {
    if (!ctx) return;
    const t0 = ctx.currentTime + (delay || 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type || 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 0.15));
    osc.connect(g).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + (dur || 0.15) + 0.05);
  }
  const SFX = {
    // بداية الجولة
    gameStart() {
      const ctx = ensureAudio(); if (!ctx) return;
      tone(ctx, 392, 0.12, 'square', 0.14);
      tone(ctx, 523, 0.12, 'square', 0.14, 0.1);
      tone(ctx, 659, 0.2, 'square', 0.16, 0.2);
    },
    // دورك (العد)
    turn() {
      const ctx = ensureAudio(); if (!ctx) return;
      tone(ctx, 880, 0.09, 'triangle', 0.22);
      tone(ctx, 880, 0.09, 'triangle', 0.22, 0.12);
    },
    // تخمين/أصوت عامة
    click() {
      const ctx = ensureAudio(); if (!ctx) return;
      tone(ctx, 700, 0.05, 'triangle', 0.1);
    },
    // تخمين غلط
    wrong() {
      const ctx = ensureAudio(); if (!ctx) return;
      tone(ctx, 220, 0.22, 'sawtooth', 0.16);
      tone(ctx, 174, 0.28, 'sawtooth', 0.16, 0.16);
    },
    // تخمين صح / قبض على الجاسوس
    correct() {
      const ctx = ensureAudio(); if (!ctx) return;
      tone(ctx, 523, 0.1, 'triangle', 0.18);
      tone(ctx, 659, 0.1, 'triangle', 0.18, 0.09);
      tone(ctx, 784, 0.24, 'triangle', 0.2, 0.18);
    },
    // كشف جاسوس (المستخدم جاسوس وانكشف)
    reveal() {
      const ctx = ensureAudio(); if (!ctx) return;
      tone(ctx, 330, 0.14, 'sine', 0.15);
      tone(ctx, 262, 0.14, 'sine', 0.15, 0.12);
      tone(ctx, 196, 0.3, 'sine', 0.16, 0.24);
    },
    // مزايدة في المزاد
    bid() {
      const ctx = ensureAudio(); if (!ctx) return;
      tone(ctx, 660, 0.07, 'square', 0.1);
      tone(ctx, 880, 0.12, 'square', 0.12, 0.07);
    },
    // خطف
    steal() {
      const ctx = ensureAudio(); if (!ctx) return;
      tone(ctx, 150, 0.12, 'sawtooth', 0.16);
      tone(ctx, 110, 0.2, 'sawtooth', 0.18, 0.1);
    },
    // فوز
    win() {
      const ctx = ensureAudio(); if (!ctx) return;
      tone(ctx, 523, 0.12, 'triangle', 0.18);
      tone(ctx, 659, 0.12, 'triangle', 0.18, 0.11);
      tone(ctx, 784, 0.12, 'triangle', 0.18, 0.22);
      tone(ctx, 1047, 0.34, 'triangle', 0.2, 0.33);
    },
    // رسالة شات
    chat() {
      const ctx = ensureAudio(); if (!ctx) return;
      tone(ctx, 988, 0.06, 'sine', 0.06);
    },
    // مين الكذاب: كشف الإجابات
    liarReveal() {
      const ctx = ensureAudio(); if (!ctx) return;
      tone(ctx, 440, 0.1, 'sine', 0.16);
      tone(ctx, 554, 0.1, 'sine', 0.16, 0.1);
      tone(ctx, 659, 0.14, 'sine', 0.18, 0.2);
    },
  };

  /* ---------------- السجل الدائم (على التليفون) ---------------- */
  const RECORD_KEY = 'khammeni_record';
  function loadRecord() {
    try { return JSON.parse(localStorage.getItem(RECORD_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function saveRecord(rec) { localStorage.setItem(RECORD_KEY, JSON.stringify(rec)); }
  function myRecordKey() { return (myName || 'لاعب').trim().toLowerCase(); }
  function renderMyRecord() {
    const rec = loadRecord();
    const r = rec[myRecordKey()] || { pts: 0, wins: 0, games: 0 };
    const ptsEl = $('rec-points'), winsEl = $('rec-wins'), gamesEl = $('rec-games');
    if (ptsEl) ptsEl.textContent = r.pts || 0;
    if (winsEl) winsEl.textContent = r.wins || 0;
    if (gamesEl) gamesEl.textContent = r.games || 0;
  }
  // تحديث السجل بنهاية كل جولة (بيتاخد من points + winnerId في الحالة)
  function bumpRecord(s) {
    if (!s || s.state !== 'over') return;
    const rec = loadRecord();
    const meKey = myRecordKey();
    const r = rec[meKey] || { pts: 0, wins: 0, games: 0 };
    const newPts = (s.points && s.points[s.myId]) || 0;
    r.pts = (r.pts || 0) + newPts;
    const meP = (s.players || []).find((p) => p.isMe);
    let iWon = false;
    if (s.winnerId === s.myId) iWon = true;
    else if (s.mode === 'spy' && meP) {
      const meIsSpy = meP.isSpy === true || meP.char === '🕵️' || (meP.char && meP.char.isSpy === true);
      iWon = (s.spiesWon === true && meIsSpy) || (s.spiesWon === false && !meIsSpy && !meP.eliminated);
    }
    if (iWon) r.wins = (r.wins || 0) + 1;
    r.games = (r.games || 0) + 1;
    rec[meKey] = r;
    saveRecord(rec);
    renderMyRecord();
  }

  /* ---------------- أدوات ---------------- */
  function show(id) {
    // لو الشاشة دي هي النشطة أصلًا، سيبنها — من غير ما نعيد تشغيل أنيميشن fadeUp
    // (الـ polling على الأندرويد كل 700ms كان بيرجّعها فتبان «بتظهر وتختفي»)
    const cur = document.querySelector('.screen.active');
    if (cur && cur.id === id) return;
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $(id).classList.add('active');
    // موسيقى الخلفية: في الشاشات الداخلية بس
    if (id === 'screen-home') stopMusic();
    else startMusic();
  }

  let toastTimer = null;
  function toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    vibrate(40);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), ms);
  }

  /* ---------------- الإشعارات داخل التطبيق (Notifications) ---------------- */
  let notifTimer = null;
  function notify(msg, icon = '🔔') {
    const b = $('notif-banner');
    $('notif-msg').textContent = msg;
    $('notif-icon').textContent = icon;
    b.classList.remove('hidden');
    vibrate(60);
    clearTimeout(notifTimer);
    notifTimer = setTimeout(() => b.classList.add('hidden'), 3600);
  }
  $('notif-close').addEventListener('click', () => {
    $('notif-banner').classList.add('hidden');
    clearTimeout(notifTimer);
  });

  function showError(id, msg) {
    const el = $(id);
    if (!msg) { el.classList.add('hidden'); return; }
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------------- صور ومعلومات الشخصيات ---------------- */
  const FLAGS = {
    'مصر': '🇪🇬', 'الجزائر': '🇩🇿', 'المغرب': '🇲🇦', 'تونس': '🇹🇳', 'ليبيا': '🇱🇾', 'السودان': '🇸🇩',
    'السعودية': '🇸🇦', 'قطر': '🇶🇦', 'الإمارات': '🇦🇪', 'الكويت': '🇰🇼', 'البحرين': '🇧🇭', 'عمان': '🇴🇲',
    'العراق': '🇮🇶', 'سوريا': '🇸🇾', 'الأردن': '🇯🇴', 'لبنان': '🇱🇧', 'فلسطين': '🇵🇸', 'اليمن': '🇾🇪',
    'موريتانيا': '🇲🇷', 'الصومال': '🇸🇴', 'جيبوتي': '🇩🇯', 'البرتغال': '🇵🇹', 'إسبانيا': '🇪🇸',
    'فرنسا': '🇫🇷', 'إنجلترا': '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'ألمانيا': '🇩🇪', 'إيطاليا': '🇮🇹', 'هولندا': '🇳🇱',
    'بلجيكا': '🇧🇪', 'كرواتيا': '🇭🇷', 'البرازيل': '🇧🇷', 'الأرجنتين': '🇦🇷', 'أوروغواي': '🇺🇾',
    'كولومبيا': '🇨🇴', 'المكسيك': '🇲🇽', 'الولايات المتحدة': '🇺🇸', 'كندا': '🇨🇦',
    'نيجيريا': '🇳🇬', 'السنغال': '🇸🇳', 'الكاميرون': '🇨🇲', 'ساحل العاج': '🇨🇮', 'غانا': '🇬🇭',
    'مالي': '🇲🇱', 'بولندا': '🇵🇱', 'النرويج': '🇳🇴', 'السويد': '🇸🇪', 'الدنمارك': '🇩🇰',
    'روسيا': '🇷🇺', 'اليابان': '🇯🇵', 'كوريا الجنوبية': '🇰🇷', 'أستراليا': '🇦🇺', 'تركيا': '🇹🇷',
    'اليونان': '🇬🇷', 'رومانيا': '🇷🇴', 'أوكرانيا': '🇺🇦', 'جنوب أفريقيا': '🇿🇦', 'أنغولا': '🇦🇴',
  };
  const POS_NAME = { GK: 'حارس مرمى', DF: 'مدافع', MF: 'وسط', FW: 'مهاجم' };
  function flagEmoji(country) {
    return FLAGS[country] || '🌍';
  }

  function factsHtml(c) {
    const p = c.profile;
    if (p) {
      const lis = (arr) => (arr || []).map((x) => `<li>${esc(x)}</li>`).join('');
      const trans = (p.prev || []).map((x) => `<li>${esc(x.t || '')} <span class="fact-year">(${esc(x.y || '')})</span></li>`).join('');
      return `
        <div class="facts-grid">
          <div class="fact-cell"><span class="fact-k">التقييم</span><b>${p.r} ⭐</b></div>
          <div class="fact-cell"><span class="fact-k">المركز</span><b>${POS_EMOJI[p.pos] || ''} ${esc(p.p || POS_NAME[p.pos] || p.pos)}</b></div>
          <div class="fact-cell"><span class="fact-k">الفريق</span><b>${esc(p.t)}</b></div>
          <div class="fact-cell"><span class="fact-k">الجنسية</span><b>${flagEmoji(p.c)} ${esc(p.c)}</b></div>
          <div class="fact-cell"><span class="fact-k">الرقم</span><b>${p.num != null ? p.num : '—'}</b></div>
          <div class="fact-cell"><span class="fact-k">القيمة</span><b>${p.v != null ? p.v + ' م' : '—'}</b></div>
        </div>
        ${(p.champs || []).length ? `<div class="fact-block"><h5>🏆 البطولات <span class="fact-ct">${p.champs.length}</span></h5><ul>${lis(p.champs)}</ul></div>` : ''}
        ${(p.ach || []).length ? `<div class="fact-block"><h5>🏅 الإنجازات <span class="fact-ct">${p.ach.length}</span></h5><ul>${lis(p.ach)}</ul></div>` : ''}
        ${trans ? `<div class="fact-block"><h5>🔄 رحلة الاحتراف</h5><ul>${trans}</ul></div>` : ''}`;
    }
    if (c.bio) return `<div class="fact-block bio-only"><p>${esc(c.bio)}</p></div>`;
    return '';
  }

  function drawCharInfo(c) {
    // معلومات الشخصية (اللاعب: بروفايل كامل، غيره: وصف مختصر) — تظهر ليك إنت بس
    const info = $('my-char-info');
    let html = '';
    if (c && (c.profile || c.bio)) html = factsHtml(c);
    info.innerHTML = html;
    info.classList.toggle('hidden', !html);
  }

  const GUESS_CHIPS = ['⚽ واخد بالك إنه نجم كرة قدم؟', '🇪🇬 مصري؟', '📺 شخصية كرتونية؟', '🎤 مغني/فنان؟', '🦁 حيوان؟', '⭐ مشهور جدًا؟'];
  const SPY_CHIPS = ['👀 إنت شايف الكلمة من الأول؟', '🤔 الكلمة مرتبطة بأكل؟', '⚽ لاعيبة كرة؟', '🎭 فنانين؟', '🕵️ في بينا جاسوس؟', '🗣️ قول الكلمة الأول!'];
  const AUCTION_CHIPS = ['💸 اللي يزود زيادة يندم', '🤔 سعر البداية والعرض الحر', '⚡ في نص الميزانية؟', '⭐ خد النجم وريّح', '😅 اديني لاعب رخيص يا معلم', '🏆 نبني تشكيلة أحلامنا'];

  function setChips(list) {
    const box = $('chat-quick');
    box.innerHTML = '';
    list.forEach((t) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = t;
      b.addEventListener('click', () => {
        $('chat-input').value = t;
        $('chat-input').focus();
      });
      box.appendChild(b);
    });
  }

  function me() {
    return state && state.players.find((p) => p.isMe);
  }

  /* ---------------- التنقل بين الشاشات ---------------- */
  function render() {
    if (!state) return;
    switch (state.state) {
      case 'lobby': renderLobby(); break;
      case 'playing':
        if (state.mode === 'auction') renderAuction();
        else if (state.mode === 'liar') renderLiarGame();
        else renderGame();
        break;
      case 'over':
        if (state.mode === 'auction') { renderAuction(); renderOver(); }
        else { renderLiarGameOrGame(); renderOver(); }
        break;
    }
  }

  function renderLiarGameOrGame() {
    if (state.mode === 'liar') renderLiarGame();
    else renderGame();
  }

  /* ================= شاشة البداية ================= */
  function setMode(m) {
    mode = m;
    $('mode-guess').classList.toggle('active', m === 'guess');
    $('mode-spy').classList.toggle('active', m === 'spy');
    $('mode-liar').classList.toggle('active', m === 'liar');
    $('mode-auction').classList.toggle('active', m === 'auction');
    const hints = {
      guess: 'كل واحد ياخد شخصية سرية من نفس الكاتيجوري، ونتناوب الأسئلة لحد ما نكشف بعض 🕵️',
      spy: 'الكل بيشوف نفس الكلمة، وواحد (أو اتنين) شايفين «جاسوس» 🕵️ — اسألوا واكشفوا الجاسوس، وفي «تصويت الآن» لو اتأكدتو',
      liar: 'الكل بيشوف نفس السؤال ويكتب إجابة، وواحد شايف سؤال مختلف 🤥 — قدروا تعرفوا مين الإجابة بتاعته مش ماشية، وبعدين صوتوا!',
      auction: 'مزاد كروت فيفا! كل واحد له ميزانية (200م لخماسية / 450م لتشكيلة 11) — زايد واشترِ، وقلب كارت الخطف في الآخر 🔨',
    };
    $('mode-hint').textContent = hints[m];
  }

  /* ================= اللوبي ================= */
  function renderLobby() {
    show('screen-lobby');
    $('room-code').textContent = state.code;
    const players = state.players;
    $('players-count').textContent = players.length;
    const list = $('lobby-players');
    // نعيد بناء القائمة بس لما حد يدخل/يخرج/يقطع — مش كل poll (علشان ما فيهاش رفرفة)
    const sig = players.map((p) => `${p.id}:${p.connected}:${p.name}`).join('|');
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      list.innerHTML = '';
      players.forEach((p) => {
        const li = document.createElement('li');
        li.className = p.connected ? '' : 'offline';
        const tags = [];
        if (p.connected) {
          if (p.isMe) tags.push('<span class="you">إنت</span>');
          if (p.id === state.host) tags.push('<span class="host-tag">👑 صاحب الأوضة</span>');
        } else {
          tags.push('<span class="host-tag">🔌 قطع</span>');
        }
        li.innerHTML = `<span>${esc(p.name)}</span><span class="tags">${tags.join(' ')}</span>`;
        list.appendChild(li);
      });
    }

    // الرابط لصاحب الأوضة — أونلاين (رابط عام) أو أوفلاين (IP الشبكة)
    const ipBox = $('host-ip-box');
    if (state.host === state.myId) {
      const lanLink = state.hostIP ? `http://${state.hostIP}:${location.port || 3000}` : '';
      const pubLink = state.hostURL || '';
      const isLocal = (u) => /localhost|127\.0\.0\.1|0\.0\.0\.0|::1|\[::1\]/.test(u);
      const shareUrl = pubLink && !isLocal(pubLink)
        ? pubLink
        : (lanLink && !isLocal(lanLink) ? lanLink : (pubLink || lanLink));
      if (shareUrl) {
        ipBox.classList.remove('hidden');
        $('host-ip').textContent = shareUrl;
        const lanEl = $('host-ip-lan');
        if (lanEl) {
          const isPrivateLAN = (u) => {
            const m = String(u).match(/^http:\/\/(\d{1,3}(?:\.\d{1,3}){3})/);
            if (!m) return false;
            const p = m[1].split('.').map(Number);
            return p[0] === 10 || (p[0] === 192 && p[1] === 168) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31);
          };
          if (lanLink && lanLink !== shareUrl && isPrivateLAN(lanLink)) {
            lanEl.textContent = 'على نفس الشبكة: ' + lanLink;
            lanEl.classList.remove('hidden');
          } else {
            lanEl.classList.add('hidden');
          }
        }
      } else {
        ipBox.classList.add('hidden');
      }
    } else {
      ipBox.classList.add('hidden');
    }

    // شارة المود
    const badges = { guess: '🎭 تخمين شخصيات', spy: '🕵️ لعبة الجاسوس', liar: '🤥 مين الكذاب؟', auction: '🔨 مزاد النجوم' };
    $('lobby-mode-badge').textContent = badges[state.mode] || '🎭';

    // اختيار الكاتيجوري (أزرار chips مش select — عشان الـ select النافذة بتختفي على الموبايل)
    const isHost = state.host === state.myId;
    renderCatPicker();
    renderDifficulty();

    // إظهار الأقسام حسب المود
    $('category-row').classList.toggle('hidden', state.mode === 'auction' || state.mode === 'liar');
    $('spy-count-row').classList.toggle('hidden', state.mode !== 'spy');
    $('squad-size-row').classList.toggle('hidden', state.mode !== 'auction');
    $('lobby-options').classList.toggle('hidden', state.mode === 'liar');
    $('btn-spy-1').classList.toggle('active', state.spiesCount === 1);
    $('btn-spy-2').classList.toggle('active', state.spiesCount === 2);
    $('btn-spy-1').disabled = !isHost;
    $('btn-spy-2').disabled = !isHost;
    $('btn-da').checked = !!state.doubleAgent;
    $('btn-da').disabled = !isHost;
    $('btn-squad-5').classList.toggle('active', state.squadSize === 5);
    $('btn-squad-11').classList.toggle('active', state.squadSize === 11);
    $('btn-squad-5').disabled = !isHost;
    $('btn-squad-11').disabled = !isHost;

    $('lobby-who-picks').classList.toggle('hidden', isHost || state.mode === 'auction' || state.mode === 'liar');
    if (!isHost && state.mode !== 'auction') {
      const cat = state.categories.find((c) => c.id === state.categoryId);
      const diffTxt = state.mode === 'guess' && state.categoryId === 'sports' && state.difficulty && state.difficulty !== 'all'
        ? ` — الصعوبة: ${DIFF_ICON[state.difficulty] || ''} ${DIFF_NAME[state.difficulty] || ''}`
        : '';
      $('lobby-who-picks').textContent = `الكاتيجوري بيختارها صاحب الأوضة${cat ? `: ${cat.emoji} ${cat.name}` : ''}${diffTxt}`;
    }

    // أزرار البدء
    const minForAuction = 2;
    $('btn-start').classList.toggle('hidden', !isHost);
    const need = state.mode === 'spy' || state.mode === 'liar' ? 3 : minForAuction;
    $('btn-start').disabled = players.filter((p) => p.connected).length < need;
    const startTexts = { guess: '▶️ ابدأ اللعب', spy: '🕵️ ابدأ لعبة الجاسوس', liar: '🤥 ابدأ مين الكذاب؟', auction: '🔨 ابدأ مزاد النجوم' };
    $('btn-start').textContent = startTexts[state.mode] || '▶️ ابدأ اللعب';
    $('lobby-wait').classList.toggle('hidden', isHost);
    const waitTexts = {
      guess: 'مستنيين صاحب الأوضة يبدأ اللعب... ⏳',
      spy: 'مستنيين صاحب الأوضة يبدأ لعبة الجاسوس... ⏳ (محتاجين 3 لاعبين على الأقل)',
      liar: 'مستنيين صاحب الأوضة يفتح سؤال مين الكذاب... ⏳ (محتاجين 3 لاعبين على الأقل)',
      auction: `مستنيين صاحب الأوضة يبدأ المزاد... ⏳ (تشكيلة ${state.squadSize}، ميزانية ${state.squadSize === 11 ? 450 : 200} مليون 💰)`,
    };
    $('lobby-wait').textContent = waitTexts[state.mode] || 'مستنيين... ⏳';

    // لوحة النقاط في اللوبي
    renderScore('lobby-score', 'lobby-scoreboard-list');

    // لو اللاعب الحالي ساب الأوضة وراح مكان تاني
    if (!state.players.some((p) => p.id === state.myId)) show('screen-home');
  }

  const DIFF_NAME = { all: 'الكل', easy: 'سهل', medium: 'متوسط', hard: 'صعب' };
  const DIFF_ICON = { all: '🎲', easy: '🟢', medium: '🟡', hard: '🔴' };
  const DIFF_OPTS = [
    ['all', '🎲 الكل'],
    ['easy', '🟢 سهل'],
    ['medium', '🟡 متوسط'],
    ['hard', '🔴 صعب'],
  ];

  // منتَقي الكاتيجوري: أزرار قابلة للضغط بدل الـ select الأصلي، فالموبايل ما فيش نافذة اختفاء وظهور
  function renderCatPicker() {
    const isHost = state.host === state.myId;
    const box = $('lobby-category-picker');
    const cats = state.categories.filter((c) => state.mode !== 'spy' || c.id !== 'mix');
    const key = cats.map((c) => c.id).join('|');
    if (box.dataset.key !== key) {
      box.dataset.key = key;
      box.innerHTML = '';
      cats.forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip picker-chip' + (c.id === state.categoryId ? ' active' : '');
        b.textContent = `${c.emoji} ${c.name}`;
        b.dataset.cid = c.id;
        b.addEventListener('click', () => {
          if (b.dataset.cid !== state.categoryId) socket.emit('set-category', { categoryId: b.dataset.cid });
        });
        box.appendChild(b);
      });
    }
    [...box.children].forEach((b) => {
      b.classList.toggle('active', b.dataset.cid === state.categoryId);
      b.disabled = !isHost;
    });
  }

  // منتَقي مستوى صعوبة لعيبة الكورة (للتخمين بس)
  function renderDifficulty() {
    const isGuessSports = state.mode === 'guess' && state.categoryId === 'sports';
    $('difficulty-row').classList.toggle('hidden', !isGuessSports);
    if (!isGuessSports) return;
    const isHost = state.host === state.myId;
    const box = $('difficulty-picker');
    if (!box.children.length) {
      DIFF_OPTS.forEach(([id, label]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'chip picker-chip' + (id === state.difficulty ? ' active' : '');
        b.textContent = label;
        b.dataset.did = id;
        b.addEventListener('click', () => {
          if (b.dataset.did !== state.difficulty) socket.emit('set-difficulty', { difficulty: b.dataset.did });
        });
        box.appendChild(b);
      });
    }
    [...box.children].forEach((b) => {
      b.classList.toggle('active', b.dataset.did === state.difficulty);
      b.disabled = !isHost;
    });
  }

  /* ---------------- لوحة النقاط ---------------- */
  function renderScore(boxId, listId) {
    const sorted = state.players
      .map((p) => ({ name: p.name, pts: state.points[p.id] || 0, isMe: p.isMe }))
      .sort((a, b) => b.pts - a.pts);
    const box = $(boxId);
    const list = $(listId);
    const any = sorted.some((s) => s.pts > 0);
    box.classList.toggle('hidden', !any);
    const sig = sorted.map((s) => `${s.name}:${s.pts}`).join('|');
    if (list.dataset.sig !== sig) {
      list.dataset.sig = sig;
      list.innerHTML = '';
      sorted.forEach((s, i) => {
        const row = document.createElement('div');
        row.className = 'score-row' + (s.isMe ? ' me' : '');
        row.innerHTML = `<span>${i + 1}. ${esc(s.name)}${s.isMe ? ' (إنت)' : ''}</span><b>⭐ ${s.pts}</b>`;
        list.appendChild(row);
      });
    }
  }

  /* ================= شاشة اللعب (تخمين/جاسوس) ================= */
  function renderGame() {
    show('screen-game');
    $('g-code').textContent = state.code;
    $('auction-wrap').classList.add('hidden');
    $('my-card').classList.remove('hidden');
    $('action-row').classList.remove('hidden');
    $('turn-bar').classList.remove('hidden');

    const meP = me();
    if (!meP) { show('screen-home'); return; }

    const isSpyMode = state.mode === 'spy';
    const iAmSpy = meP.char && meP.char.isSpy && isSpyMode;
    const iAmDA = meP.char && meP.char.isDoubleAgent && isSpyMode;

    $('g-score').classList.remove('hidden');
    $('g-score').textContent = `⭐ ${state.points[state.myId] || 0}`;
    $('g-turn-badge').textContent = isSpyMode ? '🕵️ جاسوس' : '🎭 تخمين';

    // بطاقة الكلمة/الشخصية
    const card = $('my-card');
    if (meP.char) {
      card.classList.remove('hidden');
      if (isSpyMode) {
        if (iAmSpy) {
          $('secret-label').textContent = 'إنت الجاسوس 🕵️';
          $('my-char-emoji').textContent = '🕵️';
          $('my-char-name').textContent = 'جاسوس';
          $('secret-note').textContent = 'إنت بس اللي مش شايف الكلمة! اندمج معاهم واسأل بذكاء من غير ما ينكشف إنك مش عارف 😈';
        } else if (iAmDA) {
          $('secret-label').textContent = 'إنت العميل المزدوج 🎭';
          $('my-char-emoji').textContent = meP.char.emoji;
          $('my-char-name').textContent = meP.char.name;
          $('secret-note').textContent = 'شايف الكلمة زي المدني، بس إنت شغال للجواسيس! خبّي سرك وحاول تخليهم يكسبوا — ولو اتهموك يبانوا غلط 😏';
        } else {
          $('secret-label').textContent = 'الكلمة السرية 🔑';
          $('my-char-emoji').textContent = meP.char.emoji;
          $('my-char-name').textContent = meP.char.name;
          $('secret-note').textContent = 'إنت مدني — الجواسيس شايفين بس «جاسوس». اتأكد إن صحابك شايفين نفس الكلمة واكشف الجاسوس 🕵️';
        }
      } else {
        $('secret-label').textContent = 'شخصيتك السرية 🕵️';
        $('my-char-emoji').textContent = meP.char.emoji;
        $('my-char-name').textContent = meP.char.name;
        $('secret-note').textContent = 'إنت بس اللي شايفها... صحابك يسألوك وانت تجاوب بنعم/لا';
      }
    } else {
      card.classList.add('hidden');
    }

    // الصورة + معلومات الشخصية (بتظهر ليك إنت بس — بتساعدك في التخمين)
    const myImg = $('my-char-img');
    const myEmoji = $('my-char-emoji');
    if (meP.char && !isSpyMode) {
      const src = meP.char.img ? 'img/chars/' + meP.char.img : null;
      myImg.classList.toggle('hidden', !src);
      if (src) myImg.src = src;
      myEmoji.classList.toggle('hidden', !!src);
      drawCharInfo(meP.char);
    } else if (meP.char && isSpyMode) {
      myImg.classList.add('hidden');
      myEmoji.classList.remove('hidden');
      drawCharInfo(null);
    } else {
      myImg.classList.add('hidden');
      $('my-char-info').classList.add('hidden');
    }

    // المتفرجين
    const spec = $('spectator-banner');
    spec.classList.toggle('hidden', !meP.eliminated);

    // شريط الدور
    const turnBar = $('turn-bar');
    const turnPlayer = state.players.find((p) => p.id === state.turnId);
    if (meP.eliminated) {
      turnBar.textContent = 'إنت متفرج حالياً 👀';
      turnBar.classList.remove('mine');
    } else if (state.turnId === state.myId) {
      turnBar.textContent = isSpyMode ? '⬅️ دورك! اسأل سؤال أو اتهم واحد بالجاسوسية' : '⬅️ دورك! اسأل سؤال أو مرّر الدور';
      turnBar.classList.add('mine');
    } else if (turnPlayer) {
      turnBar.textContent = `الدور على ${turnPlayer.name} يسأل 🤔`;
      turnBar.classList.remove('mine');
    }

    // أزرار
    const guessBtn = $('btn-guess');
    guessBtn.disabled = meP.eliminated;
    guessBtn.textContent = isSpyMode ? '🕵️ اتهم بالجاسوسية' : '🔍 خمّن شخصية';
    $('btn-pass').hidden = meP.eliminated;

    // طلب تصويت (صاحب الأوضة في جاسوس)
    const isHost = state.host === state.myId;
    $('vote-request-wrap').classList.toggle('hidden', !isSpyMode || !isHost || meP.eliminated);

    // عريضة التصويت
    const vp = $('vote-prompt-box');
    if (isSpyMode && state.votePrompt) {
      vp.classList.remove('hidden');
      $('vote-prompt-count').textContent = `اتجاوب ${state.voteResponded} من ${state.voteTotal}`;
      $('btn-vote-now').classList.toggle('hidden', isHost || !!state.myVoteResponse || meP.eliminated);
      $('btn-vote-later').classList.toggle('hidden', isHost || !!state.myVoteResponse || meP.eliminated);
    } else {
      vp.classList.add('hidden');
    }

    // مودال التصويت (اللي حصل عليه أغلبية)
    const vm = $('vote-modal');
    if (isSpyMode && state.voteOpen) {
      vm.classList.remove('hidden');
      $('vote-modal-count').textContent = `صوت ${state.voteCast} من ${state.voteTotal}`;
      const targets = state.voteTargets
        .map((id) => state.players.find((p) => p.id === id))
        .filter((p) => p && p.id !== state.myId);
      const box = $('vote-modal-targets');
      box.innerHTML = '';
      targets.forEach((t) => {
        const b = document.createElement('button');
        b.className = 'vote-target-btn' + (state.myVote === t.id ? ' chosen' : '');
        b.textContent = state.myVote === t.id ? `🗳️ ${esc(t.name)} (إنت صوّت) ` : `🕵️ ${esc(t.name)}`;
        b.disabled = !!state.myVote;
        if (!state.myVote) {
          b.addEventListener('click', () => socket.emit('vote-cast', { targetId: t.id }));
        }
        box.appendChild(b);
      });
    } else {
      vm.classList.add('hidden');
    }

    // شات سريع حسب المود
    const chipsBox = $('chat-quick');
    const curChips = (isSpyMode ? SPY_CHIPS : GUESS_CHIPS).join('|');
    if (chipsBox.dataset.mode !== `g${state.mode}`) {
      chipsBox.dataset.mode = `g${state.mode}`;
      setChips(isSpyMode ? SPY_CHIPS : GUESS_CHIPS);
    }

    renderChat();
  }

  /* ================= مين الكذاب؟ ================= */
  const LIAR_CHIPS = ['🤫 محدش يكتب زي السؤال ولا إيه؟', '🗣️ قولوها بصوت عالي كده', '🧐 اللي جوابه غريب في إيه؟', '🤥 الكذاب هيرتبك تحت الضغط', '👀 كل واحد يراجع جوابه', '📣 صوتوا بذكاء مش عشوائي'];

  function renderLiarGame() {
    show('screen-game');
    $('g-code').textContent = state.code;
    $('auction-wrap').classList.add('hidden');
    $('my-card').classList.add('hidden');
    $('action-row').classList.add('hidden');
    $('turn-bar').classList.add('hidden');
    $('vote-request-wrap').classList.add('hidden');
    $('vote-prompt-box').classList.add('hidden');
    $('vote-modal').classList.add('hidden');
    $('liar-wrap').classList.remove('hidden');

    const L = state.liar || {};
    $('g-turn-badge').textContent = '🤥 مين الكذاب؟';
    $('g-score').classList.remove('hidden');
    $('g-score').textContent = `⭐ ${state.points[state.myId] || 0}`;

    // شارة الكذاب
    $('liar-flag').classList.toggle('hidden', !L.iAmLiar);

    // السؤال
    $('liar-question').textContent = L.question || '...';

    const isHost = state.host === state.myId;
    const phase = L.phase;

    // مرحلة الإجابات
    const ansZone = $('liar-answer-zone');
    const hasAnswered = !!L.myAnswer;
    ansZone.classList.toggle('hidden', phase !== 'answer');
    if (phase === 'answer') {
      $('liar-answer-input').value = hasAnswered ? L.myAnswer : $('liar-answer-input').value;
      $('liar-answer-send').disabled = hasAnswered;
      $('liar-answer-send').textContent = hasAnswered ? '✅ وصلت إجابتك' : '🗳️ أرسل إجابتي';
      $('liar-answer-count').textContent = `جاوب ${hasAnswered ? L.answeredCount : L.answeredCount} من ${L.total}`;
    }

    // مرحلة العرض
    const revZone = $('liar-reveal-zone');
    revZone.classList.toggle('hidden', phase !== 'reveal');
    if (phase === 'reveal') {
      const list = $('liar-answers-list');
      list.innerHTML = '';
      (L.answers || []).forEach((a) => {
        const row = document.createElement('div');
        row.className = 'liar-answer-row' + (a.isMine ? ' mine' : '');
        row.innerHTML = `<span class="la-name">${esc(a.name)}${a.isMine ? ' (إنت)' : ''}</span><span class="la-text">«${esc(a.text)}»</span>`;
        list.appendChild(row);
      });
      $('liar-start-vote').classList.toggle('hidden', !isHost);
    }

    // مرحلة التصويت
    const voteZone = $('liar-vote-zone');
    voteZone.classList.toggle('hidden', phase !== 'vote');
    if (phase === 'vote') {
      $('liar-vote-count').textContent = `صوت ${L.votesCast} من ${L.total}`;
      const box = $('liar-vote-targets');
      box.innerHTML = '';
      (L.targets || []).forEach((t) => {
        const b = document.createElement('button');
        b.className = 'vote-target-btn' + (L.myVote === t.id ? ' chosen' : '');
        b.textContent = L.myVote === t.id ? `🗳️ ${esc(t.name)} (إنت صوّت)` : `🤥 ${esc(t.name)}`;
        b.disabled = !!L.myVote;
        if (!L.myVote) {
          b.addEventListener('click', () => socket.emit('liar-cast-vote', { targetId: t.id }));
        }
        box.appendChild(b);
      });
    }

    // مرحلة النهاية (أثناء عرض النتيجة)
    if (phase === 'over') {
      voteZone.classList.add('hidden');
      revZone.classList.add('hidden');
      ansZone.classList.add('hidden');
    }

    // شات سريع
    const chipsBox = $('chat-quick');
    if (chipsBox.dataset.mode !== 'liar') {
      chipsBox.dataset.mode = 'liar';
      setChips(LIAR_CHIPS);
    }

    renderChat();
  }

  /* ================= المزاد ================= */
  const POS_LABEL = { GK: 'حارس مرمى', DF: 'مدافع', MF: 'وسط', FW: 'مهاجم' };
  const POS_EMOJI = { GK: '🧤', DF: '🛡️', MF: '🎯', FW: '⚽' };

  function rarity(r) {
    if (r >= 90) return 'legend';
    if (r >= 87) return 'elite';
    if (r >= 84) return 'violet';
    if (r >= 80) return 'good';
    return 'base';
  }
  function rarityName(r) {
    if (r >= 90) return '⭐ أسطورة';
    if (r >= 87) return '🔥 نجم عالمي';
    if (r >= 84) return '💎 لاعب مميز';
    if (r >= 80) return '🃏 كلاسيك';
    return '🎯 أساسي';
  }
  function miniCard(c) {
    return `<div class="mini-card r-${rarity(c.r)}"><span class="mini-pos">${POS_EMOJI[c.pos] || ''}${c.pos}</span><span class="mini-name">${esc(c.n)}</span><span class="mini-r">${c.r}</span></div>`;
  }
  function teamTotal(team) {
    return (team || []).reduce((s, c) => s + c.r, 0);
  }

  function renderAuction() {
    show('screen-game');
    $('g-code').textContent = state.code;
    // نكسر شاشة التخمين
    $('my-card').classList.add('hidden');
    $('action-row').classList.add('hidden');
    $('turn-bar').classList.add('hidden');
    $('spectator-banner').classList.add('hidden');
    $('vote-request-wrap').classList.add('hidden');
    $('vote-prompt-box').classList.add('hidden');
    $('vote-modal').classList.add('hidden');
    $('auction-wrap').classList.remove('hidden');

    const a = state.auction;
    $('g-score').classList.remove('hidden');
    $('g-score').textContent = `⭐ ${state.points[state.myId] || 0}`;

    if (!a) {
      $('auct-status').textContent = 'المزاد خلص... مستنيين جولة جديدة ⏳';
      $('auct-card-zone').classList.add('hidden');
      $('auct-bid-row').classList.add('hidden');
      $('auct-steal-wrap').classList.add('hidden');
      $('auct-progress').classList.add('hidden');
      return;
    }

    const card = a.card;
    $('g-turn-badge').textContent = `🔨 ${a.phase === 'bidding' ? `كارت ${a.cardIndex + 1}/${a.deckLength}` : 'مرحلة الخطف'}`;

    // البطاقة
    $('auct-card-zone').classList.remove('hidden');
    $('auct-progress').classList.remove('hidden');
    const fc = $('auct-card');
    fc.className = 'fifa-card r-' + rarity(card ? card.r : 0);
    if (card) {
      $('auct-card-rating').textContent = card.r;
      $('auct-card-pos').textContent = `${POS_EMOJI[card.pos]} ${POS_LABEL[card.pos] || card.pos}`;
      $('auct-card-name').textContent = card.n;
      $('auct-card-club').textContent = card.t || 'نادي';
      $('auct-card-country').textContent = card.c || 'بلد';
      $('auct-card-tag').textContent = rarityName(card.r);
      $('auct-card-value').textContent = `💰 سعر البداية ${a.startBid} مليون`;
      $('auct-progress').textContent = `كارت ${a.cardIndex + 1} من ${a.deckLength} · فاضل ${a.remainingBidders} في المزايدة`;
    }

    // الميزانية
    const maxBudget = state.squadSize === 11 ? 450 : 200;
    $('auct-budget').textContent = `${a.myBudget} مليون`;
    $('auct-budget-fill').style.width = `${Math.max(0, Math.min(100, (a.myBudget / maxBudget) * 100))}%`;

    if (a.phase === 'bidding') {
      $('auct-steal-wrap').classList.add('hidden');
      $('auct-bid-row').classList.remove('hidden');
      const myTurn = a.bidTurnId === state.myId && a.iAmBidder;
      $('auct-buy').textContent = `💰 اشتري بـ ${a.currentBid} مليون`;
      const setBid = (btn, disabled) => { $(btn).disabled = disabled; };
      setBid('auct-buy', !myTurn);
      setBid('auct-r1', !myTurn);
      setBid('auct-r5', !myTurn);
      setBid('auct-r10', !myTurn);
      setBid('auct-pass', !myTurn);
      let status;
      if (myTurn) {
        status = '⬅️ دورك! اشتري أو زايد أو اخرج';
        $('auct-status').className = 'auct-status mine';
      } else if (!a.iAmBidder) {
        status = 'خرجت من المزايدة على الكارت ده ⏭️';
        $('auct-status').className = 'auct-status';
      } else {
        const biderP = state.players.find((p) => p.id === a.bidTurnId);
        status = biderP ? `الدور على ${biderP.name} يبصم 💬` : 'مستنيين اللعيبة...';
        $('auct-status').className = 'auct-status';
      }
      $('auct-status').textContent = status;
    } else {
      // مرحلة الخطف
      $('auct-bid-row').classList.add('hidden');
      $('auct-steal-wrap').classList.remove('hidden');
      $('auct-steal-turn').textContent = 'مرحلة الخطف ⚡ — كل واحد له خطفة واحدة';
      $('auct-progress').textContent = 'مرحلة الخطف ⚡ — كل واحد له خطفة واحدة';
      const curStealer = a.stealTurnId;
      const myTurnSteal = a.canSteal;
      if (myTurnSteal) {
        $('auct-steal-turn').textContent = '⬅️ دورك تخطف! اختار كارت من تشكيلة حد تاني';
      } else if (curStealer) {
        const sp = state.players.find((p) => p.id === curStealer);
        $('auct-steal-turn').textContent = `بينتظر ${sp ? sp.name : '...'} يخطف ⚡`;
      }
      const targetsBox = $('auct-steal-targets');
      const sel = { targetId: null, index: null };
      targetsBox.innerHTML = '';
      state.players
        .filter((p) => p.id !== state.myId && p.connected && (a.teams[p.id] || []).length)
        .forEach((p) => {
          const team = a.teams[p.id] || [];
          const wrap = document.createElement('div');
          wrap.className = 'steal-player';
          const head = document.createElement('div');
          head.className = 'steal-player-name';
          head.textContent = `${p.name} (مجموع ${teamTotal(team)})`;
          wrap.appendChild(head);
          const cardsRow = document.createElement('div');
          cardsRow.className = 'mini-row';
          team.forEach((c, idx) => {
            const mn = document.createElement('div');
            mn.className = 'steal-target-card';
            mn.innerHTML = miniCard(c);
            if (myTurnSteal) {
              mn.addEventListener('click', () => {
                sel.targetId = p.id;
                sel.index = idx;
                targetsBox.querySelectorAll('.steal-target-card').forEach((x) => x.classList.remove('picked'));
                mn.classList.add('picked');
                $('auct-steal-confirm').classList.remove('hidden');
              });
            }
            cardsRow.appendChild(mn);
          });
          wrap.appendChild(cardsRow);
          targetsBox.appendChild(wrap);
        });
      $('auct-steal-confirm').classList.toggle('hidden', !myTurnSteal);
      $('auct-steal-skip').classList.toggle('hidden', !myTurnSteal);
      $('auct-steal-confirm').onclick = () => {
        if (!sel.targetId) { toast('اختار كارت الأول 😅'); return; }
        socket.emit('steal-act', { steal: true, targetId: sel.targetId, cardIndex: sel.index });
        sel.targetId = null; sel.index = null;
      };
      $('auct-steal-skip').onclick = () => {
        socket.emit('steal-act', { steal: false });
      };
    }

    // تشكيلتي
    $('auct-my-team').innerHTML = a.myTeam.length
      ? a.myTeam.map((c) => miniCard(c)).join('')
      : '<span class="empty-note">لسه مفيش كروت... اكسب الأول 😅</span>';
    $('auct-my-total').textContent = `مجموع ${teamTotal(a.myTeam)}`;

    // تشكيلات المنافسين
    const teamsBox = $('auct-teams');
    const rivals = state.players
      .filter((p) => p.id !== state.myId && p.connected)
      .map((p) => ({ p, team: a.teams[p.id] || [] }))
      .sort((x, y) => teamTotal(y.team) - teamTotal(x.team));
    teamsBox.innerHTML = '';
    if (!rivals.length) {
      teamsBox.innerHTML = '<span class="empty-note">مفيش منافسين 😅</span>';
    }
    rivals.forEach(({ p, team }) => {
      const row = document.createElement('div');
      row.className = 'rival-team';
      row.innerHTML = `<div class="rival-head"><span>${esc(p.name)}</span><b class="rival-total">${teamTotal(team)}</b></div><div class="mini-row">${team.length ? team.map((c) => miniCard(c)).join('') : '<span class="empty-note">مفيش كروت</span>'}</div>`;
      teamsBox.appendChild(row);
    });

    // الشات
    const chipsBox = $('chat-quick');
    if (chipsBox.dataset.mode !== 'auction') {
      chipsBox.dataset.mode = 'auction';
      setChips(AUCTION_CHIPS);
    }
    renderChat();
  }

  /* ================= الشاات ================= */
  function renderChat() {
    const list = $('chat-list');
    list.innerHTML = '';
    state.chat.forEach((m) => {
      const div = document.createElement('div');
      if (m.system) {
        div.className = 'chat-msg system';
        div.textContent = m.text;
      } else if (m.media) {
        div.className = 'chat-msg ' + (m.from === myName ? 'me media' : 'other media');
        if (m.from !== myName) {
          const sp = document.createElement('span');
          sp.className = 'sender';
          sp.textContent = m.from;
          div.appendChild(sp);
        }
        const holder = document.createElement('div');
        holder.className = 'chat-media';
        if (m.media.type === 'image') {
          const img = document.createElement('img');
          img.src = m.media.data;
          img.alt = 'صوره';
          img.className = 'chat-img';
          img.addEventListener('click', () => {
            const mv = $('media-viewer');
            const mvImg = $('media-viewer-img');
            if (mvImg && mv) { mvImg.src = m.media.data; mv.classList.remove('hidden'); }
          });
          holder.appendChild(img);
          div.appendChild(holder);
        } else if (m.media.type === 'audio') {
          const au = document.createElement('audio');
          au.src = m.media.data;
          au.controls = true;
          au.preload = 'metadata';
          holder.appendChild(au);
          div.appendChild(holder);
        } else if (m.media.type === 'video') {
          const vd = document.createElement('video');
          vd.src = m.media.data;
          vd.controls = true;
          vd.preload = 'metadata';
          vd.className = 'chat-video';
          holder.appendChild(vd);
          div.appendChild(holder);
        }
      } else if (m.from === myName) {
        div.className = 'chat-msg me';
        div.textContent = m.text;
      } else {
        div.className = 'chat-msg other';
        div.innerHTML = `<span class="sender">${esc(m.from)}</span>${esc(m.text)}`;
      }
      list.appendChild(div);
    });
    list.scrollTop = list.scrollHeight;
  }

  /* ================= نهاية الجولة ================= */
  function renderOver() {
    const modal = $('over-modal');
    const isSpyMode = state.mode === 'spy';
    const isAuction = state.mode === 'auction';
    const isLiar = state.mode === 'liar';
    const Lr = (isLiar && state.liar && state.liar.reveal) || null;

    // إخفاء/إظهار صندوق كشف مين الكذاب
    const liarBox = $('liar-reveal-box');
    liarBox.classList.toggle('hidden', !Lr);
    if (Lr) {
      $('liar-reveal-name').textContent = `${Lr.liarName} كان الكذاب 🤥`;
      $('liar-reveal-q').textContent = `السؤال الحقيقي: «${Lr.question}»`;
      $('liar-reveal-a').textContent = `سؤال الكذاب: «${Lr.liarQuestion}» — وجوابه: «${Lr.liarAnswer || '—'}»`;
      $('liar-reveal-result').textContent = Lr.caught
        ? '🎉 قبضنا عليه! اللي عرفوه كسبوا'
        : (Lr.liarId === state.myId ? '😏 إنت الكذاب ونجيت! الزتونة دي هتدفع تمنها' : '😏 الكذاب نجا!');
    }
    if (isLiar) {
      $('winner-emoji').textContent = Lr && Lr.caught ? '🎉' : '🤥';
      $('winner-text').textContent = Lr
        ? (Lr.caught ? 'اتقبضنا على الكذاب!' : 'الكذاب خدّع الكل ونزل منها سليم!')
        : 'خلصت الجولة';
    }

    if (isAuction) {
      $('spy-word-reveal').classList.add('hidden');
      const res = state.auctionResult || [];
      const winner = res[0] && state.players.find((p) => p.id === res[0].id);
      $('winner-emoji').textContent = winner && winner.isMe ? '👑' : '🏆';
      $('winner-text').textContent = winner
        ? (winner.isMe ? 'إنت كسبت المزاد! يا سوبر ستار 🔥' : `${winner.name} كسب المزاد! 🏆`)
        : 'المزاد خلص';
      const list = $('auction-result-list');
      list.innerHTML = '';
      res.forEach((r, i) => {
        const p = state.players.find((x) => x.id === r.id);
        const row = document.createElement('div');
        row.className = 'auction-result-row' + (i === 0 ? ' first' : '');
        row.innerHTML = `<div class="ar-head"><span>${i + 1}. ${p ? esc(p.name) : '—'} (${r.total})</span><span class="ar-badge">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : ''}</span></div><div class="mini-row">${r.team.map((c) => miniCard(c)).join('')}</div>`;
        list.appendChild(row);
      });
      $('auction-result').classList.remove('hidden');
      $('reveal-list').classList.add('hidden');
    } else {
      $('auction-result').classList.add('hidden');
      $('reveal-list').classList.toggle('hidden', isLiar);
      if (isSpyMode) {
        $('winner-emoji').textContent = state.spiesWon ? '🕵️' : '🎉';
        $('winner-text').textContent = state.spiesWon
          ? 'الجواسيس كسبوا! 🕵️'
          : state.spiesWon === false
            ? 'المدنيين كسبوا! 🎉 قبضوا على الجاسوس'
            : 'خلصت الجولة';
        const wd = $('spy-word-reveal');
        if (state.word) {
          wd.textContent = `الكلمة كانت: ${state.word.emoji} ${state.word.name}`;
          wd.classList.remove('hidden');
        } else {
          wd.classList.add('hidden');
        }
      } else {
        $('spy-word-reveal').classList.add('hidden');
        const winner = state.players.find((p) => p.id === state.winnerId);
        $('winner-emoji').textContent = winner && winner.isMe ? '👑' : '🏆';
        $('winner-text').textContent = winner
          ? (winner.isMe ? 'إنت كسبت! يا أسطورة 🔥' : `${winner.name} كسب الجولة!`)
          : 'خلصت الجولة';
      }

      const list = $('reveal-list');
      list.innerHTML = '';
      state.players.forEach((p) => {
        const row = document.createElement('div');
        const winRow = !isSpyMode && p.id === state.winnerId;
        const spyRow = isSpyMode && p.char && p.char.isSpy;
        row.className = 'reveal-row'
          + (winRow ? ' winner-row' : '')
          + (spyRow ? ' spy-row' : '');
        if (p.char) {
          const label = isSpyMode && p.char.isSpy
            ? '🕵️ جاسوس'
            : (p.char.img
              ? `<img class="reveal-img" src="img/chars/${esc(p.char.img)}" alt="${esc(p.char.name)}"><b>${esc(p.char.name)}</b>`
              : `${p.char.emoji} ${esc(p.char.name)}`);
          row.innerHTML = `<span>${esc(p.name)}</span><span class="char-part">${label}</span>`;
        } else {
          row.innerHTML = `<span>${esc(p.name)}</span><span class="char-part">مش لابس شخصية</span>`;
        }
        list.appendChild(row);
      });
    }

    // لوحة النقاط
    renderScore('over-score', 'over-scoreboard-list');

    const isHost = state.host === state.myId;
    $('btn-next-round').textContent = isSpyMode ? '🕵️ جولة جاسوس تانية' : isAuction ? '🔨 مزاد تاني' : isLiar ? '🤥 جولة كذاب تانية' : '🔄 جولة تانية';
    $('btn-next-round').classList.toggle('hidden', !isHost);
    modal.classList.remove('hidden');
  }

  /* ================= مودال التخمين/الاتهام ================= */
  function openGuess() {
    if (!state || state.state !== 'playing') return;
    const meP = me();
    if (!meP || meP.eliminated) return;

    const isSpyMode = state.mode === 'spy';
    $('guess-modal-title').textContent = isSpyMode ? '🕵️ اتهم مين بالجاسوسية؟' : '🔍 خمّن مين؟';
    $('guess-target-label').textContent = isSpyMode ? 'مين اللي شكّك إنه الجاسوس؟' : 'على مين بتحاول تعرف شخصيته؟';
    $('guess-word-zone').classList.toggle('hidden', isSpyMode);
    $('guess-hint').textContent = isSpyMode
      ? '⚠️ لو اتهّمت غلط هتخرّج من اللعب!'
      : '⚠️ لو خمّنت غلط هتخرج من الجولة!';
    $('guess-submit').textContent = isSpyMode ? 'اتهمه ⚠️' : 'أكد التخمين ⚡';
    $('guess-input').required = !isSpyMode;

    const sel = $('guess-target');
    sel.innerHTML = '';
    // أثناء اللعب الـ char لغيري بيكون null في الحالة المرسلة — المطلوب أسماء اللاعبين الأحياء بس
    const targets = state.players.filter((p) => !p.isMe && p.connected && !p.eliminated);
    if (!targets.length) { toast('مفيش حد متبقي 😐'); return; }
    targets.forEach((t) => {
      const opt = document.createElement('option');
      opt.value = t.id;
      opt.textContent = t.name;
      sel.appendChild(opt);
    });
    $('guess-input').value = '';
    $('guess-modal').classList.remove('hidden');
    setTimeout(() => {
      if (!isSpyMode) $('guess-input').focus();
    }, 50);
  }

  /* ---------------- أحداث الواجهة ---------------- */
  $('mode-guess').addEventListener('click', () => setMode('guess'));
  $('mode-spy').addEventListener('click', () => setMode('spy'));
  $('mode-liar').addEventListener('click', () => setMode('liar'));
  $('mode-auction').addEventListener('click', () => setMode('auction'));

  /* ---- الإعدادات: فتح/قفل + تطبيق على كل تغيير ---- */
  const openSettings = () => $('settings-modal').classList.remove('hidden');
  $('btn-settings').addEventListener('click', openSettings);
  $('settings-close').addEventListener('click', () => $('settings-modal').classList.add('hidden'));
  $('settings-modal').addEventListener('click', (e) => {
    if (e.target === $('settings-modal')) $('settings-modal').classList.add('hidden');
  });
  const bindSetting = (id, key, fn) => {
    const el = $(id);
    el.checked = !!settings[key];
    el.addEventListener('change', () => {
      settings[key] = el.checked;
      saveSettings();
      applySettings();
      if (fn) fn(el.checked);
    });
  };
  bindSetting('set-sound', 'sound');
  bindSetting('set-music', 'music');
  bindSetting('set-vibrate', 'vibrate');
  bindSetting('set-anim', 'anim');
  bindSetting('set-dark', 'dark');
  $('set-lang').value = settings.lang;
  $('set-lang').addEventListener('change', () => {
    settings.lang = $('set-lang').value;
    saveSettings();
    applySettings();
  });
  $('set-font').value = settings.font;
  $('set-font').addEventListener('input', () => {
    settings.font = Number($('set-font').value) || 100;
    saveSettings();
    applySettings();
  });
  applySettings();

  /* ---- مودال رمز QR للانضمام السريع (Feature 8) ---- */
  const drawQrInModal = () => {
    const url = ($('host-ip').textContent || '').trim();
    $('qr-link').textContent = url;
    const canvas = $('qr-canvas');
    const ctx = canvas && canvas.getContext ? canvas.getContext('2d') : null;
    if (!url || !ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    const n = qr.getModuleCount();
    const cell = Math.floor(canvas.width / (n + 2));
    const size = n * cell;
    const off = Math.floor((canvas.width - size) / 2);
    ctx.fillStyle = '#111';
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (qr.isDark(r, c)) ctx.fillRect(off + c * cell, off + r * cell, cell, cell);
      }
    }
  };
  $('btn-show-qr').addEventListener('click', () => {
    drawQrInModal();
    $('qr-modal').classList.remove('hidden');
  });
  $('qr-close').addEventListener('click', () => $('qr-modal').classList.add('hidden'));
  $('qr-modal').addEventListener('click', (e) => {
    if (e.target === $('qr-modal')) $('qr-modal').classList.add('hidden');
  });

  /* ---- نسخ لينك الانضمام (أونلاين أو أوفلاين) ---- */
  const copyLinkBtn = $('btn-copy-link');
  if (copyLinkBtn) {
    const legacyCopy = (text, done) => {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        if (document.execCommand) document.execCommand('copy');
        document.body.removeChild(ta);
        done && done();
      } catch (e) { /* المنسوخ يتبعت يدوي */ }
    };
    copyLinkBtn.addEventListener('click', () => {
      const link = ($('host-ip').textContent || '').trim();
      if (!link) return;
      const ok = () => toast('📋 اتنسخ اللينك — ابعته لصحابك 🌍');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(ok).catch(() => legacyCopy(link, ok));
      } else legacyCopy(link, ok);
    });
  }

  $('btn-create').addEventListener('click', () => {
    const name = $('inp-name').value.trim() || 'لاعب';
    myName = name;
    localStorage.setItem('khammeni_name', name);
    showError('home-error');
    socket.emit('create-room', { name, mode, v: PROTOCOL_VERSION }, (res) => {
      if (!res || !res.ok) showError('home-error', (res && res.error) || 'حصلت مشكلة');
    });
  });

  $('btn-join').addEventListener('click', () => {
    const name = $('inp-name').value.trim() || 'لاعب';
    const code = $('inp-join-code').value.trim().toUpperCase();
    if (!code) { showError('home-error', 'اكتب كود الأوضة الأول'); return; }
    myName = name;
    localStorage.setItem('khammeni_name', name);
    showError('home-error');
    socket.emit('join-room', { name, code, v: PROTOCOL_VERSION }, (res) => {
      if (!res || !res.ok) showError('home-error', (res && res.error) || 'حصلت مشكلة');
    });
  });

  ['inp-name'].forEach((id) => {
    $(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') $('btn-create').click();
    });
  });
  $('inp-join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-join').click();
  });

  // اختيار الكاتيجوري والصعوبة: ربطهما جوه renderCatPicker/renderDifficulty بأزرار chips
  $('btn-spy-1').addEventListener('click', () => {
    socket.emit('set-spy-count', { count: 1 });
  });
  $('btn-spy-2').addEventListener('click', () => {
    socket.emit('set-spy-count', { count: 2 });
  });
  $('btn-da').addEventListener('change', () => {
    socket.emit('set-double-agent', { on: $('btn-da').checked });
  });
  $('btn-squad-5').addEventListener('click', () => {
    socket.emit('set-squad-size', { size: 5 });
  });
  $('btn-squad-11').addEventListener('click', () => {
    socket.emit('set-squad-size', { size: 11 });
  });

  $('btn-start').addEventListener('click', () => {
    socket.emit('start-game', { squadSize: state && state.squadSize }, (res) => {
      if (res && !res.ok) toast(res.error);
    });
  });

  $('btn-leave-lobby').addEventListener('click', () => {
    socket.emit('leave-room');
    state = null;
    show('screen-home');
  });

  $('btn-leave-game').addEventListener('click', () => {
    socket.emit('leave-room');
    state = null;
    show('screen-home');
  });

  $('btn-guess').addEventListener('click', openGuess);

  $('btn-pass').addEventListener('click', () => {
    socket.emit('pass-turn');
  });

  $('guess-submit').addEventListener('click', () => {
    const targetId = $('guess-target').value;
    const isSpyMode = state && state.mode === 'spy';
    const guess = $('guess-input').value.trim();
    if (!targetId) { toast('اختار اللاعب الأول'); return; }
    if (!isSpyMode && !guess) { toast('اكتب الاسم الأول'); return; }
    SFX.click();
    socket.emit('make-guess', { targetId, guess }, () => {});
    $('guess-modal').classList.add('hidden');
  });

  $('guess-cancel').addEventListener('click', () => $('guess-modal').classList.add('hidden'));

  /* ---- أزرار مين الكذاب؟ ---- */
  $('liar-answer-send').addEventListener('click', () => {
    const text = $('liar-answer-input').value.trim();
    if (!text) { toast('اكتب إجابتك الأول 😅'); return; }
    socket.emit('liar-answer', { text }, (res) => {
      if (res && !res.ok) toast(res.error || 'حصلت مشكلة');
      else $('liar-answer-input').value = '';
    });
  });

  $('liar-start-vote').addEventListener('click', () => {
    SFX.click();
    socket.emit('liar-start-vote', {}, (res) => {
      if (res && !res.ok) toast(res.error || 'حصلت مشكلة');
    });
  });

  /* ---- أزرار المزاد ---- */
  $('auct-buy').addEventListener('click', () => { SFX.click(); socket.emit('auction-act', { action: 'buy' }); });
  $('auct-r1').addEventListener('click', () => { SFX.click(); socket.emit('auction-act', { action: 'raise', amount: 1 }); });
  $('auct-r5').addEventListener('click', () => { SFX.click(); socket.emit('auction-act', { action: 'raise', amount: 5 }); });
  $('auct-r10').addEventListener('click', () => { SFX.click(); socket.emit('auction-act', { action: 'raise', amount: 10 }); });
  $('auct-pass').addEventListener('click', () => { SFX.click(); socket.emit('auction-act', { action: 'pass' }); });

  /* ---- أزرار التصويت ---- */
  $('btn-request-vote').addEventListener('click', () => {
    socket.emit('request-vote');
  });
  $('btn-vote-now').addEventListener('click', () => {
    socket.emit('vote-response', { now: true });
  });
  $('btn-vote-later').addEventListener('click', () => {
    socket.emit('vote-response', { now: false });
  });

  $('btn-next-round').addEventListener('click', () => {
    $('over-modal').classList.add('hidden');
    socket.emit('next-round', { squadSize: state && state.squadSize });
  });

  $('btn-back-lobby').addEventListener('click', () => {
    socket.emit('leave-room');
    $('over-modal').classList.add('hidden');
    state = null;
    show('screen-home');
  });

  // الشاات
  function sendChat() {
    const inp = $('chat-input');
    const text = inp.value.trim();
    if (!text) return;
    SFX.click();
    socket.emit('chat', { text });
    inp.value = '';
  }
  $('chat-send').addEventListener('click', sendChat);
  $('chat-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat(); });

  /* ---- ميديا في الشات (Feature 2): صورة / فيديو / تسجيل صوتي ---- */
  const MEDIA_LIMITS = { image: 700000, audio: 1500000, video: 3000000 };
  let voiceRec = null;        // MediaRecorder الجاري
  let voiceChunks = [];
  let voiceStream = null;

  function mediaErr(msg) {
    const banner = $('notif-banner'), t = $('notif-msg');
    if (banner && t) { t.textContent = msg; banner.classList.remove('hidden'); }
  }

  function readFileAsDataURL(file, cb) {
    const fr = new FileReader();
    fr.onload = () => cb(fr.result);
    fr.onerror = () => cb(null);
    fr.readAsDataURL(file);
  }

  function sendMedia(type, dataUrl) {
    const cap = MEDIA_LIMITS[type];
    if (!cap || !dataUrl || !String(dataUrl).startsWith('data:')) { mediaErr('الملف ده مش صالح 😕'); return; }
    if (String(dataUrl).length > cap) {
      const names = { image: 'الصورة', audio: 'التسجيل', video: 'الفيديو' };
      mediaErr(`${names[type]} كبيرة أوي — جرب واحدة أصغر 📉`);
      return;
    }
    SFX.click();
    socket.emit('chat-media', { media: { type, data: dataUrl } }, (res) => {
      if (!res || !res.ok) mediaErr((res && res.error) || 'حصلت مشكلة في رفع الميديا');
    });
  }

  // صورة من الكاميرا/المعرض
  $('btn-chat-img').addEventListener('click', () => $('chat-file-img').click());
  $('chat-file-img').addEventListener('change', () => {
    const f = $('chat-file-img').files && $('chat-file-img').files[0];
    $('chat-file-img').value = '';
    if (!f) return;
    readFileAsDataURL(f, (d) => {
      if (!d) { mediaErr('مقدرناش نقرأ الصورة'); return; }
      downscaleImage(d, (small) => sendMedia('image', small || d));
    });
  });

  // فيديو قصير من الكاميرا/المعرض
  $('btn-chat-video').addEventListener('click', () => $('chat-file-video').click());
  $('chat-file-video').addEventListener('change', () => {
    const f = $('chat-file-video').files && $('chat-file-video').files[0];
    $('chat-file-video').value = '';
    if (!f) return;
    readFileAsDataURL(f, (d) => { if (d) sendMedia('video', d); });
  });

  // تسجيل صوتي 🎤 (MediaRecorder)
  $('btn-chat-voice').addEventListener('click', () => {
    if (voiceRec && voiceRec.state === 'recording') { stopVoice(); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      mediaErr('التسجيل الصوتي مش متاح على الجهاز ده 🎤');
      return;
    }
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      voiceStream = stream;
      voiceChunks = [];
      let mime = 'audio/webm';
      if (window.MediaRecorder.isTypeSupported && !MediaRecorder.isTypeSupported(mime)) mime = 'audio/mp4';
      voiceRec = new MediaRecorder(stream, { mimeType: mime });
      voiceRec.ondataavailable = (e) => { if (e.data && e.data.size) voiceChunks.push(e.data); };
      voiceRec.onstop = () => {
        const blob = new Blob(voiceChunks, { type: voiceRec.mimeType || 'audio/webm' });
        const fr = new FileReader();
        fr.onload = () => sendMedia('audio', fr.result);
        fr.onerror = () => mediaErr('مقدرناش نسجل الصوت');
        fr.readAsDataURL(blob);
        voiceStream.getTracks().forEach((t) => t.stop());
        voiceRec = null; voiceStream = null; voiceChunks = [];
      };
      voiceRec.start();
      mediaErr('🎙️ في تسجيل... دوس تاني يعمل إرسال');
    }).catch(() => mediaErr('مش عارفين نوصل للميكروفون 🎤'));
  });

  function stopVoice() {
    if (voiceRec && voiceRec.state === 'recording') voiceRec.stop();
  }

  // تصغير الصور عشان تقل الحمولة (أمان: لو فشل فك الصورة نبعت الأصلية)
  function downscaleImage(dataUrl, cb, maxSide) {
    maxSide = maxSide || 900;
    let done = false;
    const finish = (v) => { if (!done) { done = true; cb(v); } };
    const img = new Image();
    img.onload = () => {
      try {
        if (!img.width || !img.height) { finish(dataUrl); return; }
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        const ctx = cv.getContext('2d');
        if (!ctx) { finish(dataUrl); return; }
        ctx.drawImage(img, 0, 0, w, h);
        finish(cv.toDataURL('image/jpeg', 0.75));
      } catch (e) { finish(dataUrl); }
    };
    img.onerror = () => finish(dataUrl);
    setTimeout(() => finish(dataUrl), 300); // ضمان إن الـ callback بيتنادى في كل الحالات
    img.src = dataUrl;
  }

  // معاينة كبيرة للصورة
  $('media-viewer').addEventListener('click', (e) => {
    if (e.target === $('media-viewer') || e.target.closest('#media-viewer-close')) {
      $('media-viewer').classList.add('hidden');
    }
  });

  /* ---------------- استقبال الحالة ---------------- */
  let prevStateKey = '';   // آخر «مفتاح» للحالة — عشان نطلق الأصوات عند الانتقالات
  let prevTurnId = null;
  let prevChatLen = 0;
  let prevChLiarPhase = null;
  let prevBid = 0;
  let prevElimCount = 0;
  let prevLeader = null;

  // نصوص الإشعارات
  const notifText = {
    gameStart: 'اللعبة بدأت!',
    gameOver: 'الجولة خلصت!',
    yourTurn: 'دورك الآن!',
    newLeader: 'حد جديد خد الصدارة في النقاط!',
  };
  function leaderOf(s) {
    const pts = s.points || {};
    let top = null, topv = -1;
    for (const k of Object.keys(pts)) {
      if (pts[k] > topv) { top = k; topv = pts[k]; }
    }
    return top;
  }
  socket.on('state', (s) => {
    state = s;
    window.__state = s; // للفحص
    const key = s.state + '|' + (s.mode || '');
    // انتقالات الأصوات
    if (prevStateKey && prevStateKey !== key) {
      if (s.state === 'playing') {
        SFX.gameStart();                 // بداية جولة
        notify(notifText.gameStart, '🎮');
      }
      if (s.state === 'over') {
        const meP = (s.players || []).find((p) => p.isMe);
        if (meP && meP.eliminated) SFX.reveal(); else SFX.win();  // فوز/انكشاف
        notify(notifText.gameOver, '🏁');
      }
    }
    if (s.state === 'playing' && s.turnId && prevTurnId !== s.turnId && s.turnId === s.myId) {
      SFX.turn(); // دورك
      notify(notifText.yourTurn, '🎯');
    } else if (s.state === 'playing' && s.turnId && prevTurnId !== s.turnId) {
      SFX.click();
    }
    // حد اخد الصدارة في النقاط
    if (s.points && prevLeader !== leaderOf(s) && s.state === 'playing') {
      const l = leaderOf(s);
      if (l !== s.myId) notify(notifText.newLeader, '👑');
    }
    prevLeader = s.points ? leaderOf(s) : null;
    if (s.mode === 'auction' && s.auction && s.auction.phase === 'steal' && prevStateKey && !prevStateKey.endsWith('steal')) {
      SFX.steal();
    }
    if (s.mode === 'liar' && s.liar && s.liar.phase === 'reveal' && prevChLiarPhase && prevChLiarPhase !== 'reveal') {
      SFX.liarReveal();
    }
    prevChLiarPhase = s.mode === 'liar' && s.liar ? s.liar.phase : null;
    // رسالة شات جديدة (من غيري)
    if (s.chat && prevChatLen && s.chat.length > prevChatLen) {
      const newest = s.chat[s.chat.length - 1];
      if (newest && !newest.system) SFX.chat();
    }
    // مزايدة المزاد: سعر اتحرك
    if (s.mode === 'auction' && s.auction && prevBid > 0 && s.auction.currentBid !== prevBid) SFX.bid();
    prevBid = (s.mode === 'auction' && s.auction) ? (s.auction.currentBid || 0) : 0;
    // تخمين غلط: حد اتعزل (غيري)
    if (s.state === 'playing' && prevElimCount > 0) {
      const nc = (s.players || []).filter((p) => p.eliminated).length;
      if (nc > prevElimCount) SFX.wrong();
      prevElimCount = nc;
    }
    prevChatLen = s.chat ? s.chat.length : 0;
    prevTurnId = s.turnId || null;
    prevStateKey = key;
    bumpRecord(s);
    render();
  });

  socket.on('connect', () => {
    if (myName && !localStorage.getItem('khammeni_name')) localStorage.setItem('khammeni_name', myName);
  });

  /* ---------------- البدء ---------------- */
  const saved = localStorage.getItem('khammeni_name');
  if (saved) $('inp-name').value = saved;
  setMode('guess');
  setChips(GUESS_CHIPS);
  $('chat-quick').dataset.mode = 'guess';
  renderMyRecord();
  show('screen-home');
})();