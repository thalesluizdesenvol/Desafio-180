/* ============================================
   SLOTMESTRE v3.0 — APP.JS
   Leve · Elegante · Sem dependências externas
   ============================================ */
'use strict';

const APP_VERSION = '3.0.0';
const STORAGE_KEYS = {
  GAMES:    'sm_games_v8',            // v8: catálogo embutido com URLs reais
  GAMES_V7: 'sm_games_v7',            // legado — usado só para migração
  SOCIAL:   'sm_social_v3',
  CLICKS:   'sm_clicks_v3',
  SESSION:  'sm_admin_session',
  ATTEMPTS: 'sm_login_attempts',
  LOCKOUT:  'sm_lockout_until',
  CREDS:    'sm_admin_creds',        // mantido p/ compatibilidade
  USERS:    'sm_users_v1',            // novo: lista de perfis
};

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const SESSION_DURATION_MS = 4 * 60 * 60 * 1000;

// ============ SISTEMA DE PERMISSÕES ============
const ROLES = {
  super_admin: {
    label: '👑 Super Admin',
    description: 'Acesso total. Pode gerenciar usuários, zerar catálogo, tudo.',
    color: '#F59E0B',
    permissions: [
      'manage_users',      // criar/editar/deletar outros usuários
      'clear_catalog',     // zerar catálogo todo
      'bulk_edit',         // bulk URLs/links em massa
      'edit_games',        // editar jogos
      'delete_games',      // deletar jogos
      'edit_social',       // links sociais
      'edit_settings',     // configurações gerais
      'export_data',       // export/import backup
      'view_all'           // ver todas as páginas
    ]
  },
  editor: {
    label: '✏️ Editor',
    description: 'Pode editar jogos e configurações, mas não mexe em usuários nem zera o catálogo.',
    color: '#3B82F6',
    permissions: [
      'bulk_edit',
      'edit_games',
      'edit_social',
      'view_all'
    ]
  },
  viewer: {
    label: '👁️ Visualizador',
    description: 'Apenas vê dashboards e insights. Não edita nada.',
    color: '#10B981',
    permissions: [
      'view_all'
    ]
  }
};

function hasPermission(user, perm) {
  if (!user || !user.role) return false;
  const role = ROLES[user.role];
  if (!role) return false;
  return role.permissions.includes(perm);
}

const PROVIDER_META = {
  pgsoft:    { name:'PG Soft',         color:'#E11D48', dot:'#E11D48' },
  pragmatic: { name:'Pragmatic Play',  color:'#F59E0B', dot:'#F59E0B' },
  evolution: { name:'Evolution Gaming',color:'#8B5CF6', dot:'#8B5CF6' },
};

const DEFAULT_SOCIAL = { ig:'#', tg:'#', wa:'#' };

/* ============================================
   STORAGE
   ============================================ */
function store(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); return true; }
  catch(e) { console.warn('Storage error', e); return false; }
}
function load(key, fallback = null) {
  try { const r = localStorage.getItem(key); return r !== null ? JSON.parse(r) : fallback; }
  catch { return fallback; }
}

// IDs removidos da v4: selos de regulamentação (95-99) e passos iOS (735, 736).
// Se por algum motivo esses itens ainda estiverem salvos no storage
// (ex.: alguém com v8 antigo antes desta release), purgamos.
const REMOVED_GAME_IDS = new Set([95, 96, 97, 98, 99, 735, 736]);

function getGames() {
  let g = load(STORAGE_KEYS.GAMES, null);
  const wasCleared = localStorage.getItem('sm_catalog_cleared') === '1';

  if (!g) {
    // Primeira visita OU migração do v7.
    // Se houver um sm_games_v7 antigo, preservamos clicks e link customizados.
    const legacy = load(STORAGE_KEYS.GAMES_V7, null);
    g = window.SlotMestreCatalog.buildFullCatalog();

    if (legacy && Array.isArray(legacy) && legacy.length) {
      // Indexa o catálogo antigo por id para lookup O(1)
      const legacyById = {};
      legacy.forEach(item => { if (item && item.id != null) legacyById[item.id] = item; });

      g.forEach(game => {
        const old = legacyById[game.id];
        if (old) {
          // Herda apenas link customizado e clicks acumulados;
          // img, name, theme, etc vêm SEMPRE do novo catálogo.
          if (old.link && typeof old.link === 'string' && old.link.trim()) {
            game.link = old.link;
          }
          if (typeof old.clicks === 'number' && old.clicks > 0) {
            game.clicks = old.clicks;
          }
        }
      });
    }

    g.forEach(game => {
      if (game.img && game.img.includes('slotcatalog.com')) game.img = '';
    });
    store(STORAGE_KEYS.GAMES, g);
  } else if (!g.length && !wasCleared) {
    // Array vazio mas não foi zerado propositalmente → recarrega
    g = window.SlotMestreCatalog.buildFullCatalog();
    g.forEach(game => {
      if (game.img && game.img.includes('slotcatalog.com')) game.img = '';
    });
    store(STORAGE_KEYS.GAMES, g);
  } else {
    // Migração silenciosa: limpa URLs quebradas E purga IDs removidos
    const before = g.length;
    g = g.filter(game => !REMOVED_GAME_IDS.has(game && game.id));
    let dirty = g.length !== before;
    g.forEach(game => {
      if (game.img && game.img.includes('slotcatalog.com')) {
        game.img = '';
        dirty = true;
      }
    });
    if (dirty) store(STORAGE_KEYS.GAMES, g);
  }
  return g;
}
function saveGames(g) {
  store(STORAGE_KEYS.GAMES, g);
  // Marca se foi zerado propositalmente, pra não auto-restaurar
  if (!g.length) localStorage.setItem('sm_catalog_cleared', '1');
  else localStorage.removeItem('sm_catalog_cleared');
  try { window.dispatchEvent(new CustomEvent('sm:gamesUpdated')); } catch {}
}
function getSocial() { return load(STORAGE_KEYS.SOCIAL, DEFAULT_SOCIAL); }
function saveSocial(s){ store(STORAGE_KEYS.SOCIAL, s); }

/* ============================================
   SECURITY
   ============================================ */
async function hashString(str) {
  if (window.crypto && window.crypto.subtle) {
    const enc = new TextEncoder().encode(str);
    const buf = await window.crypto.subtle.digest('SHA-256', enc);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 0x01000193) >>> 0; }
  return h.toString(16);
}
function generateToken() {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b=>b.toString(16).padStart(2,'0')).join('');
}
function createSession(token, expires) {
  sessionStorage.setItem(STORAGE_KEYS.SESSION, JSON.stringify({ token, expires }));
}
function getSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(STORAGE_KEYS.SESSION));
    if (!s) return null;
    if (Date.now() > s.expires) { clearSession(); return null; }
    return s;
  } catch { return null; }
}
function clearSession() {
  sessionStorage.removeItem(STORAGE_KEYS.SESSION);
  clearCurrentUser();
}
function isLoggedIn() { return getSession() !== null; }
function refreshSession() {
  const s = getSession();
  if (s) createSession(s.token, Date.now() + SESSION_DURATION_MS);
}

function getLoginAttempts() { return parseInt(localStorage.getItem(STORAGE_KEYS.ATTEMPTS) || '0'); }
function bumpLoginAttempts() {
  const n = getLoginAttempts() + 1;
  localStorage.setItem(STORAGE_KEYS.ATTEMPTS, String(n));
  if (n >= MAX_LOGIN_ATTEMPTS) {
    localStorage.setItem(STORAGE_KEYS.LOCKOUT, String(Date.now() + LOCKOUT_DURATION_MS));
  }
  return n;
}
function resetLoginAttempts() {
  localStorage.removeItem(STORAGE_KEYS.ATTEMPTS);
  localStorage.removeItem(STORAGE_KEYS.LOCKOUT);
}
function isLockedOut() {
  const until = parseInt(localStorage.getItem(STORAGE_KEYS.LOCKOUT) || '0');
  return Date.now() < until;
}
function lockoutRemainingMs() {
  const until = parseInt(localStorage.getItem(STORAGE_KEYS.LOCKOUT) || '0');
  return Math.max(0, until - Date.now());
}

const DEFAULT_CREDS = { user:'admin', pass:'slotmestre2026' };
function getAdminCreds() { return load(STORAGE_KEYS.CREDS, DEFAULT_CREDS); }
function saveAdminCreds(user, passHash) { store(STORAGE_KEYS.CREDS, { user, passHash }); }

/* ============================================
   SISTEMA DE USUÁRIOS MÚLTIPLOS
   ============================================ */

// Usuário root — sempre existe, nunca pode ser deletado
const ROOT_USERNAME = 'admin';

function getUsers() {
  let users = load(STORAGE_KEYS.USERS, null);

  if (!users || !users.length) {
    // Primeira instalação ou migração da versão antiga:
    // Cria o usuário root "admin" com a senha padrão
    users = [{
      id: 1,
      username: ROOT_USERNAME,
      passHash: null,  // será hasheada no primeiro login
      role: 'super_admin',
      isRoot: true,    // nunca pode ser deletado
      createdAt: Date.now(),
      lastLogin: null
    }];

    // Se tinha credenciais antigas no sistema single-user, migra
    const oldCreds = load(STORAGE_KEYS.CREDS, null);
    if (oldCreds && oldCreds.passHash) {
      users[0].username = oldCreds.user || ROOT_USERNAME;
      users[0].passHash = oldCreds.passHash;
    }

    store(STORAGE_KEYS.USERS, users);
  }

  // Garantia: sempre deve existir pelo menos 1 super_admin root
  const hasRoot = users.some(u => u.isRoot && u.role === 'super_admin');
  if (!hasRoot) {
    users.unshift({
      id: Math.max(...users.map(u => u.id || 0), 0) + 1,
      username: ROOT_USERNAME,
      passHash: null,
      role: 'super_admin',
      isRoot: true,
      createdAt: Date.now(),
      lastLogin: null
    });
    store(STORAGE_KEYS.USERS, users);
  }

  return users;
}

function saveUsers(users) {
  store(STORAGE_KEYS.USERS, users);
}

function findUserByUsername(username) {
  const users = getUsers();
  return users.find(u => u.username.toLowerCase() === String(username || '').toLowerCase());
}

async function verifyLogin(usernameInput, passInput) {
  const user = findUserByUsername(usernameInput);
  if (!user) {
    // Fallback para sistema antigo (compatibilidade)
    return await verifyLoginLegacy(usernameInput, passInput);
  }

  // Se usuário root nunca fez login, compara com senha padrão
  if (user.isRoot && !user.passHash) {
    if (passInput === DEFAULT_CREDS.pass) {
      // Hasheia a senha no primeiro login
      user.passHash = await hashString(passInput);
      user.lastLogin = Date.now();
      const users = getUsers();
      const idx = users.findIndex(u => u.id === user.id);
      if (idx >= 0) { users[idx] = user; saveUsers(users); }
      setCurrentUser(user);
      return true;
    }
    return false;
  }

  // Login normal: compara hash
  if (!user.passHash) return false;
  const h = await hashString(passInput);
  if (h === user.passHash) {
    user.lastLogin = Date.now();
    const users = getUsers();
    const idx = users.findIndex(u => u.id === user.id);
    if (idx >= 0) { users[idx] = user; saveUsers(users); }
    setCurrentUser(user);
    return true;
  }
  return false;
}

// Fallback para o sistema antigo (caso alguém tenha storage pré-migração)
async function verifyLoginLegacy(user, pass) {
  const c = getAdminCreds();
  if (c.passHash) {
    const h = await hashString(pass);
    const ok = user === c.user && h === c.passHash;
    if (ok) {
      setCurrentUser({ id: 1, username: user, role: 'super_admin', isRoot: true });
    }
    return ok;
  }
  const ok = user === (c.user || DEFAULT_CREDS.user) && pass === (c.pass || DEFAULT_CREDS.pass);
  if (ok) {
    const h = await hashString(pass);
    saveAdminCreds(user, h);
    setCurrentUser({ id: 1, username: user, role: 'super_admin', isRoot: true });
  }
  return ok;
}

// Rastreia qual usuário está logado na sessão atual
function setCurrentUser(user) {
  const minimal = {
    id: user.id,
    username: user.username,
    role: user.role,
    isRoot: !!user.isRoot
  };
  sessionStorage.setItem('sm_current_user', JSON.stringify(minimal));
}

function getCurrentUser() {
  try {
    const raw = sessionStorage.getItem('sm_current_user');
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function clearCurrentUser() {
  sessionStorage.removeItem('sm_current_user');
}

function sanitize(str) {
  const d = document.createElement('div');
  d.textContent = String(str || '');
  return d.innerHTML;
}

/* ============================================
   HEADER
   ============================================ */
function initHeader() {
  const h = document.getElementById('header');
  if (!h) return;
  window.addEventListener('scroll', () => h.classList.toggle('scrolled', window.scrollY > 50), { passive: true });

  const hamburger = document.getElementById('hamburger');
  const nav = document.getElementById('navLinks');
  if (hamburger && nav) {
    hamburger.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('open');
      hamburger.classList.toggle('open', isOpen);
    });
    nav.querySelectorAll('.nav-link').forEach(l => {
      l.addEventListener('click', () => {
        nav.classList.remove('open');
        hamburger.classList.remove('open');
      });
    });
  }
}

/* ============================================
   SOCIAL
   ============================================ */
function applySocialLinks() {
  const s = getSocial();
  const map = {
    'hdr-ig':s.ig, 'hdr-tg':s.tg,
    'hero-tg':s.tg,
    'float-ig':s.ig, 'float-tg':s.tg,
    'foot-ig':s.ig, 'foot-tg':s.tg,
    'tgModalLink': s.tg,
  };
  Object.entries(map).forEach(([id, url]) => {
    const el = document.getElementById(id);
    if (el) el.href = (url && url !== '#') ? url : '#';
  });
}

/* ============================================
   COUNTERS
   ============================================ */
function animateCounters() {
  document.querySelectorAll('[data-target]').forEach(el => {
    const target = parseInt(el.dataset.target);
    if (!target) return;
    let current = 0;
    const inc = Math.max(1, target / 60);
    const timer = setInterval(() => {
      current = Math.min(current + inc, target);
      el.textContent = Math.floor(current);
      if (current >= target) clearInterval(timer);
    }, 16);
  });
}

/* ============================================
   TICKER
   ============================================ */
function renderTicker() {
  const wrap = document.getElementById('tickerContent');
  if (!wrap) return;
  const games = getGames().filter(g => g.hot === 'fire');
  const names = ['ana_luz','bia_vibes','carol_sortuda','dani_slots','juli_lucky','mari_bolada','nati_queen','sofia_r','lara_bet','gabi_play'];
  const pick = () => names[Math.floor(Math.random() * names.length)];
  const pickG = () => games[Math.floor(Math.random() * games.length)]?.name || 'Fortune Tiger';
  const items = [
    `🏆 @${pick()} ganhou R$${(1 + Math.random()*7).toFixed(1)}k em ${pickG()}`,
    `🔥 Super vitória em ${pickG()}`,
    `⭐ @${pick()} acertou rodada bônus em ${pickG()}`,
    `💎 RTP MÁXIMO agora em ${pickG()}`,
    `🎰 @${pick()} ganhou R$${(2 + Math.random()*10).toFixed(1)}k em ${pickG()}`,
    `✨ @${pick()} deu sorte no ${pickG()}`,
    `💖 @${pick()} ativou free spins em ${pickG()}`,
    `🌸 @${pick()} com streak de vitórias em ${pickG()}`,
  ];
  const sep = '<span class="ticker-sep">✦</span>';
  const line = items.join(sep);
  wrap.innerHTML = `<span class="ticker-content">${line}${sep}${line}${sep}</span>`;
}

/* ============================================
   CARDS GRID (INDEX)
   ============================================ */
/**
 * Domínios que sabemos que bloqueiam hotlinking — automaticamente passam por proxy.
 * O proxy remove headers problemáticos (referer, origin) e re-serve a imagem
 * como se viesse de um domínio neutro.
 */
const HOTLINK_BLOCKED_DOMAINS = [
  'rainhadoslot.com.br',
  'graficodosslots.com.br',
  'casinoscores.com',
  'slotcatalog.com',
  'slotsjudge.com',
  'casino.org'
];

/**
 * Lista de proxies em ordem de preferência.
 * Estes serviços servem como "ponte" pra contornar bloqueios de hotlinking.
 * Se um falhar, tenta o próximo via fallback.
 */
const IMAGE_PROXIES = [
  (url) => `https://images.weserv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ''))}&w=340&h=180&fit=cover&output=webp`,
  (url) => `https://wsrv.nl/?url=${encodeURIComponent(url.replace(/^https?:\/\//, ''))}&w=340&h=180&fit=cover`,
  (url) => `https://cdn.statically.io/img/${url.replace(/^https?:\/\//, '').replace(/^www\./, '')}?w=340&h=180&f=webp`,
];

function shouldUseProxy(url) {
  if (!url || typeof url !== 'string') return false;
  if (url.startsWith('data:')) return false;
  // Evita proxy-em-proxy
  if (url.includes('images.weserv.nl') || url.includes('wsrv.nl') || url.includes('statically.io')) return false;
  const lower = url.toLowerCase();
  return HOTLINK_BLOCKED_DOMAINS.some(d => lower.includes(d));
}

function applyProxy(url, proxyIndex = 0) {
  if (proxyIndex >= IMAGE_PROXIES.length) return url;
  try {
    return IMAGE_PROXIES[proxyIndex](url);
  } catch {
    return url;
  }
}

function resolveThumbnail(game) {
  // REGRA PRINCIPAL: se o usuário definiu URL customizada no admin, USA ELA.
  // Sem proxies, sem upgrades, sem mágica. É a URL do admin, ponto.
  if (game.img && typeof game.img === 'string' && game.img.trim() && !game.img.startsWith('data:')) {
    return game.img.trim();
  }

  // Sem URL no admin: SVG gerado como último recurso (não bloqueia render).
  if (window.SlotMestreCatalog?.generateThumbnail) {
    return window.SlotMestreCatalog.generateThumbnail(game);
  }
  return '';
}

/**
 * Se a URL do admin falhar de verdade (onerror do browser), cai no SVG.
 * Sem timeout artificial, sem proxies, sem upgrade para CDN oficial —
 * a URL do admin é respeitada e o browser tem tempo ilimitado para carregá-la.
 */
function attachImgFallback(imgEl, game) {
  if (!imgEl || !game) return;

  const originalUrl = (game.img || '').trim();

  // Tem URL do admin → só instala fallback para SVG em caso de erro REAL do browser.
  // Nada de timeout, nada de upgrade, nada de substituição automática.
  if (originalUrl && !originalUrl.startsWith('data:')) {
    imgEl.addEventListener('error', () => {
      try {
        imgEl.onerror = null;
        if (window.SlotMestreCatalog?.generateThumbnail) {
          imgEl.src = window.SlotMestreCatalog.generateThumbnail(game);
        }
      } catch {}
    }, { once: true });
    return;
  }

  // Sem URL do admin: o src já é SVG gerado (via resolveThumbnail), nada a fazer.
}

/* ============================================
   VALORES DINÂMICOS POR JOGO (ciclo de 5 minutos)
   ============================================ */
const DYNAMIC_CYCLE_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Gera um "seed" inteiro pseudo-aleatório a partir de (gameId + slotDeTempo).
 * A mesma combinação sempre produz os mesmos valores,
 * garantindo que dentro da mesma janela de 5min todos os usuários vejam
 * os mesmos valores e tudo mude junto quando a janela troca.
 */
function hashSeed(gameId, slotNum) {
  let h = (gameId * 2654435761) ^ (slotNum * 40503);
  h = (h ^ (h >>> 13)) * 1274126177;
  return Math.abs(h ^ (h >>> 16));
}

function seededRand(seed, offset) {
  const x = Math.sin(seed + offset * 97) * 10000;
  return x - Math.floor(x);
}

/**
 * Calcula os valores dinâmicos do jogo para o slot atual de 5min.
 * Cada jogo tem sua própria baseline influenciada pelo seu RTP real.
 */
function computeDynamicValues(game) {
  const slotNum = Math.floor(Date.now() / DYNAMIC_CYCLE_MS);
  const seed = hashSeed(game.id, slotNum);

  // Aposta Padrão: 70-96% (jogos "hot" tendem a aparecer alto)
  const boost = game.hot === 'fire' ? 10 : 0;
  const padrao = Math.round(70 + seededRand(seed, 1) * 22 + boost * seededRand(seed, 7));
  const padraoFinal = Math.min(96, padrao);

  // Aposta Mínima: 55-90%
  const minima = Math.round(55 + seededRand(seed, 2) * 30 + boost * 0.5);
  const minimaFinal = Math.min(92, minima);

  // RTP exibido: oscila em torno do RTP real do jogo (±2%)
  const rtpBase = game.rtp || game.dist || 96;
  const rtpOsc = (seededRand(seed, 3) - 0.5) * 4; // -2 a +2
  const rtpShown = Math.max(85, Math.min(99, Math.round(rtpBase + rtpOsc)));

  // Bet sugerida (valores em R$) — VALORES FIXOS
  // Mi: 0,40/0,50 · PD: 1,00/1,20 · Mbc: 4,00/4,50
  const pdLow  = 1.00;
  const pdHigh = 1.20;
  const miLow  = 0.40;
  const miHigh = 0.50;
  const mbcLow = 4.00;
  const mbcHigh = 4.50;

  // Multiplicadores pagos (MP): números de 1 a 9, 3-5 sorteados, ordenados
  const digits = [];
  for (let i = 0; i < 9; i++) {
    if (seededRand(seed, 20 + i) > 0.55) digits.push(i + 1);
  }
  while (digits.length < 3) digits.push(1 + Math.floor(seededRand(seed, 30 + digits.length) * 9));
  const mp = [...new Set(digits)].sort((a, b) => a - b).slice(0, 5).join(',');

  // Timer: minutos restantes até o próximo ciclo (regressivo)
  const elapsed = Date.now() % DYNAMIC_CYCLE_MS;
  const remaining = DYNAMIC_CYCLE_MS - elapsed;
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const timer = `${mins}:${String(secs).padStart(2, '0')}`;

  return {
    padrao: padraoFinal,
    minima: minimaFinal,
    rtp: rtpShown,
    pd: `R$${pdLow.toFixed(2).replace('.', ',')} a R$${pdHigh.toFixed(2).replace('.', ',')}`,
    mi: `R$${miLow.toFixed(2).replace('.', ',')} a R$${miHigh.toFixed(2).replace('.', ',')}`,
    mbc: `R$${mbcLow.toFixed(2).replace('.', ',')} a R$${mbcHigh.toFixed(2).replace('.', ',')}`,
    mp,
    timer
  };
}

/* ============================================
   RENDER CARDS (INDEX) — layout compacto novo
   ============================================ */
function renderCards(filter = 'all', search = '') {
  const grid = document.getElementById('cardsGrid');
  if (!grid) return;

  const games = getGames();
  let list = filter === 'all' ? games : games.filter(g => g.provider === filter);
  if (search) {
    const q = search.toLowerCase();
    list = list.filter(g => g.name.toLowerCase().includes(q) || (PROVIDER_META[g.provider]?.name || '').toLowerCase().includes(q));
  }

  // atualizar contadores nas tabs
  document.querySelectorAll('.tab').forEach(tab => {
    const f = tab.dataset.filter;
    const count = f === 'all' ? games.length : games.filter(g => g.provider === f).length;
    const base = tab.dataset.originalName || tab.childNodes[0]?.textContent.trim() || '';
    tab.dataset.originalName = base;
    tab.innerHTML = `${base} <span class="tab-count">${count}</span>`;
  });

  if (!list.length) {
    const isEmptyCatalog = games.length === 0;
    if (isEmptyCatalog) {
      grid.innerHTML = `<div class="cards-empty" style="grid-column: 1 / -1; text-align: center; padding: 60px 20px;">
        <div class="empty-icon" style="font-size: 3.5rem; margin-bottom: 16px;">📦</div>
        <div style="font-size: 1.2rem; font-weight: 600; color: #E5E7EB; margin-bottom: 8px;">Catálogo vazio</div>
        <div style="color: #94A3B8; font-size: 0.9rem; max-width: 360px; margin: 0 auto;">
          Acesse o <strong>painel admin → Configurações → URLs de Imagens em Massa</strong> e use <strong>"🎁 Aplicar + Criar Faltantes"</strong> para popular o catálogo.
        </div>
      </div>`;
    } else {
      grid.innerHTML = `<div class="cards-empty"><div class="empty-icon">🎀</div><div>Nenhum jogo encontrado.</div></div>`;
    }
    updateLastUpdated();
    return;
  }

  grid.innerHTML = '';
  // PERFORMANCE: usa DocumentFragment para fazer apenas 1 reflow, não N
  const fragment = document.createDocumentFragment();
  const imgFallbackQueue = []; // defere attachImgFallback para depois do paint

  list.forEach((g, i) => {
    const card = document.createElement('article');
    card.className = 'game-card-v2';
    // Só anima os primeiros 30 cards (o resto não precisa — content-visibility cuida)
    if (i < 30) {
      card.style.animationDelay = `${i * 0.025}s`;
    } else {
      card.style.animation = 'none';
    }
    card.dataset.provider = g.provider;
    card.dataset.gameId = g.id;

    const hasLink = g.link && g.link.trim() && g.link.trim() !== '#';
    const href = hasLink ? g.link : '#';
    const thumb = resolveThumbnail(g);
    const prov = PROVIDER_META[g.provider] || { name: g.provider, color:'#C084FC' };
    const d = computeDynamicValues(g);

    card.innerHTML = `
      <div class="gcv2-top">
        <div class="gcv2-rtp-badge">RTP: <strong>${d.rtp}%</strong></div>
        ${g.hot === 'fire'
          ? '<div class="gcv2-hot-badge">🔥 QUENTE</div>'
          : '<div class="gcv2-hot-badge gcv2-hot-neutral">✨ NOVO</div>'}
      </div>

      <div class="gcv2-thumb-wrap">
        <img src="${sanitize(thumb)}" alt="${sanitize(g.name)}" class="gcv2-thumb" loading="lazy">
      </div>

      <div class="gcv2-provider">
        <span class="gcv2-provider-dot" style="background:${prov.color}"></span>
        <span class="gcv2-provider-name">${sanitize(prov.name.toUpperCase())}</span>
      </div>

      <h3 class="gcv2-title">${sanitize(g.name)}</h3>

      <div class="gcv2-bars">
        <div class="gcv2-bar-row">
          <div class="gcv2-bar-head">
            <span>Aposta Padrão</span>
            <strong data-v="padrao">${d.padrao}%</strong>
          </div>
          <div class="gcv2-bar"><div class="gcv2-bar-fill gcv2-bar-green" data-v="padrao-bar" style="width:${d.padrao}%"></div></div>
        </div>
        <div class="gcv2-bar-row">
          <div class="gcv2-bar-head">
            <span>Aposta Mínima</span>
            <strong data-v="minima">${d.minima}%</strong>
          </div>
          <div class="gcv2-bar"><div class="gcv2-bar-fill gcv2-bar-purple" data-v="minima-bar" style="width:${d.minima}%"></div></div>
        </div>
        <div class="gcv2-bar-row">
          <div class="gcv2-bar-head">
            <span>RTP</span>
            <strong data-v="rtp">${d.rtp}%</strong>
          </div>
          <div class="gcv2-bar"><div class="gcv2-bar-fill gcv2-bar-red" data-v="rtp-bar" style="width:${d.rtp}%"></div></div>
        </div>
      </div>

      <div class="gcv2-bet-box">
        <div class="gcv2-bet-header">
          <span class="gcv2-bet-title">⚡ BET SUGERIDA</span>
          <span class="gcv2-bet-timer">🕐 <span data-v="timer">${d.timer}</span></span>
        </div>
        <div class="gcv2-bet-row"><span>PD:</span><strong data-v="pd">${d.pd}</strong></div>
        <div class="gcv2-bet-row"><span>Mi:</span><strong data-v="mi">${d.mi}</strong></div>
        <div class="gcv2-bet-row"><span>Mbc:</span><strong data-v="mbc">${d.mbc}</strong></div>
        <div class="gcv2-bet-row gcv2-bet-mp"><span>MP:</span><strong data-v="mp">${d.mp}</strong></div>
      </div>

      <div class="gcv2-actions">
        <a href="${hasLink ? sanitize(href) : '#'}"
           class="gcv2-btn-play${hasLink ? '' : ' no-link'}"
           ${hasLink ? 'target="_blank" rel="noopener noreferrer"' : ''}
           data-game-id="${g.id}">
          ▶ ${hasLink ? 'JOGAR AGORA' : 'EM BREVE'}
        </a>
        <button class="gcv2-btn-copy" title="Copiar link do jogo" data-copy-id="${g.id}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
        </button>
      </div>
    `;

    card.querySelectorAll('[data-game-id]').forEach(el => {
      el.addEventListener('click', e => {
        if (el.classList.contains('no-link')) { e.preventDefault(); return; }
        trackClick(g.id);
      });
    });

    card.querySelector('[data-copy-id]')?.addEventListener('click', async () => {
      if (!hasLink) { showToast('Este jogo ainda não tem link configurado', 'info'); return; }
      try {
        await navigator.clipboard.writeText(href);
        showToast('Link copiado! 💖', 'success');
      } catch {
        showToast('Não foi possível copiar', 'error');
      }
    });

    // Fallback automático de imagem: defere para após o paint (não bloqueia render)
    const imgEl = card.querySelector('.gcv2-thumb');
    if (imgEl) imgFallbackQueue.push([imgEl, g]);

    fragment.appendChild(card);
  });

  // 1 único appendChild = 1 único reflow (vs 445 antes)
  grid.appendChild(fragment);

  // Processa fallbacks de imagem em idle time, fora do critical path
  if (imgFallbackQueue.length) {
    const processFallbacks = (deadline) => {
      while (imgFallbackQueue.length && (!deadline || deadline.timeRemaining() > 2)) {
        const [el, gm] = imgFallbackQueue.shift();
        try { attachImgFallback(el, gm); } catch {}
      }
      if (imgFallbackQueue.length) {
        if (window.requestIdleCallback) {
          requestIdleCallback(processFallbacks, { timeout: 1000 });
        } else {
          setTimeout(() => processFallbacks(), 50);
        }
      }
    };
    if (window.requestIdleCallback) {
      requestIdleCallback(processFallbacks, { timeout: 500 });
    } else {
      setTimeout(() => processFallbacks(), 16);
    }
  }

  updateLastUpdated();
}

function updateLastUpdated() {
  const t = new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  const el = document.getElementById('lastUpdated');
  if (el) el.textContent = t;
  const hero = document.getElementById('heroLastUpdate');
  if (hero) hero.textContent = t.slice(0,5);
}

/* ============================================
   TRACKING DE CLICKS
   ----------------------------------------------
   Nota: hoje os cliques ficam no localStorage do VISITANTE, então o
   admin só vê o que o próprio admin clicou. Para agregar clicks de
   todos os visitantes é preciso um backend/API. Próximo passo na
   roadmap — até lá, o tracking segue local.
   ============================================ */
function trackClick(gameId) {
  const games = getGames();
  const g = games.find(x => x.id === gameId);
  if (g) {
    g.clicks = (g.clicks || 0) + 1;
    saveGames(games);
  }
}

/* ============================================
   FILTER / SORT
   ============================================ */
function initFilters() {
  const tabs = document.querySelectorAll('.tab');
  const getState = () => ({
    filter: document.querySelector('.tab.active')?.dataset.filter || 'all',
    search: document.getElementById('gameSearch')?.value.trim() || '',
  });

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const s = getState();
      renderCards(tab.dataset.filter, s.search);
    });
  });

  const search = document.getElementById('gameSearch');
  if (search) {
    let t;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const s = getState();
        renderCards(s.filter, s.search);
      }, 300);
    });
  }
}

/* ============================================
   TOAST
   ============================================ */
function showToast(msg, type = 'default') {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = `toast ${type} show`;
  clearTimeout(t._timeout);
  t._timeout = setTimeout(() => t.classList.remove('show'), 2500);
}

/* ============================================
   AGE GATE
   ============================================ */
function initAgeGate() {
  // AGE GATE APARECE SEMPRE — não usa sessionStorage
  // (exigência legal: confirmação a cada visita ao site de apostas)
  const overlay = document.getElementById('ageGate');
  if (!overlay) return;
  overlay.classList.add('show');

  document.getElementById('ageYes')?.addEventListener('click', () => {
    overlay.classList.add('hide');
    setTimeout(() => { overlay.style.display = 'none'; }, 500);
    // Só mostra Telegram se ainda não mostrou nesta sessão
    if (!sessionStorage.getItem('sm_tg_shown')) {
      setTimeout(initTelegramModal, 900);
    }
  });

  document.getElementById('ageNo')?.addEventListener('click', () => {
    document.body.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1a0b2e;flex-direction:column;gap:18px;font-family:'Exo 2',sans-serif;color:#f0c3ff;text-align:center;padding:24px">
        <div style="font-size:4.5rem">🚫</div>
        <div style="font-size:1.6rem;color:#fff;font-family:'Playfair Display',serif;font-weight:700">Acesso Restrito</div>
        <div style="max-width:420px;line-height:1.6">Este site é destinado exclusivamente a maiores de 18 anos.</div>
      </div>`;
  });
}

function initTelegramModal() {
  if (sessionStorage.getItem('sm_tg_shown')) return;
  sessionStorage.setItem('sm_tg_shown', '1');
  const modal = document.getElementById('tgModal');
  if (!modal) return;
  modal.style.display = 'flex';
  requestAnimationFrame(() => modal.classList.add('show'));

  const s = getSocial();
  const tgLink = document.getElementById('tgModalLink');
  if (tgLink && s.tg && s.tg !== '#') tgLink.href = s.tg;

  const closeModal = () => {
    modal.classList.remove('show');
    setTimeout(() => { modal.style.display = 'none'; }, 400);
  };
  document.getElementById('tgModalClose')?.addEventListener('click', closeModal);
  document.getElementById('tgModalSkip')?.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
}

/* ============================================
   BACKGROUND CANVAS (suave, feminino)
   ============================================ */
function initBackgroundCanvas() {
  const canvas = document.getElementById('bgCanvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  const particles = [];
  const count = Math.min(35, Math.floor(window.innerWidth / 40));
  const colors = ['rgba(244,114,182,', 'rgba(192,132,252,', 'rgba(251,191,36,', 'rgba(236,72,153,'];
  for (let i = 0; i < count; i++) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.2,
      vy: (Math.random() - 0.5) * 0.2,
      r: Math.random() * 2.5 + 0.5,
      c: colors[Math.floor(Math.random() * colors.length)],
      alpha: Math.random() * 0.4 + 0.1,
    });
  }

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
      if (p.y < 0 || p.y > canvas.height) p.vy *= -1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.c + p.alpha + ')';
      ctx.fill();
    });
    requestAnimationFrame(draw);
  }
  draw();
}

/* ============================================
   INIT MAIN (INDEX)
   ============================================ */
function initMain() {
  initBackgroundCanvas();
  initHeader();
  applySocialLinks();
  renderTicker();
  assignTestLinks();      // links de placeholder para teste
  renderCards();
  initFilters();
  initAgeGate();
  startDynamicCycle();    // atualiza valores dos cards em tempo real

  window.addEventListener('sm:gamesUpdated', () => {
    const f = document.querySelector('.tab.active')?.dataset.filter || 'all';
    const q = document.getElementById('gameSearch')?.value.trim() || '';
    renderCards(f, q);
    renderTicker();
  });

  // Counters
  const statsEl = document.querySelector('.hero-stats');
  if (statsEl) {
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting) { animateCounters(); obs.disconnect(); }
    });
    obs.observe(statsEl);
  }

  // Refresh ticker every minute
  setInterval(renderTicker, 60000);
}

/* ============================================
   CICLO DINÂMICO — atualiza valores dos cards
   (tick do timer a cada 1s, rerender do grid a cada 5min)
   ============================================ */
function startDynamicCycle() {
  let lastSlot = Math.floor(Date.now() / DYNAMIC_CYCLE_MS);
  let timerNodes = []; // cache dos nós de timer (evita querySelectorAll 1x/seg)
  let intervalId = null;

  // Invalida cache quando jogos são atualizados
  window.addEventListener('sm:gamesUpdated', () => { timerNodes = []; });

  const rebuildCache = () => {
    timerNodes = Array.from(document.querySelectorAll('.game-card-v2 [data-v="timer"]'));
  };

  const tick = () => {
    const currentSlot = Math.floor(Date.now() / DYNAMIC_CYCLE_MS);

    if (currentSlot !== lastSlot) {
      lastSlot = currentSlot;
      refreshAllCardValues(true);
      timerNodes = [];
    } else {
      if (timerNodes.length === 0) rebuildCache();
      if (timerNodes.length === 0) return;

      const elapsed = Date.now() % DYNAMIC_CYCLE_MS;
      const remaining = DYNAMIC_CYCLE_MS - elapsed;
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      const timer = `${mins}:${String(secs).padStart(2, '0')}`;

      requestAnimationFrame(() => {
        for (let i = 0; i < timerNodes.length; i++) {
          const el = timerNodes[i];
          if (el && el.isConnected && el.textContent !== timer) {
            el.textContent = timer;
          }
        }
      });
    }
  };

  const start = () => {
    if (intervalId) return;
    intervalId = setInterval(tick, 1000);
  };
  const stop = () => {
    if (!intervalId) return;
    clearInterval(intervalId);
    intervalId = null;
  };

  // Pausa quando aba não está visível (economia significativa de CPU/bateria)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else {
      timerNodes = []; // força rebuild
      tick(); // atualização imediata
      start();
    }
  });

  start();
}

/**
 * Atualiza apenas o texto do timer em cada card (chamado a cada segundo)
 */
function refreshAllCardTimers() {
  const elapsed = Date.now() % DYNAMIC_CYCLE_MS;
  const remaining = DYNAMIC_CYCLE_MS - elapsed;
  const mins = Math.floor(remaining / 60000);
  const secs = Math.floor((remaining % 60000) / 1000);
  const timer = `${mins}:${String(secs).padStart(2, '0')}`;

  document.querySelectorAll('.game-card-v2 [data-v="timer"]').forEach(el => {
    el.textContent = timer;
  });
}

/**
 * Recalcula e atualiza todos os valores dinâmicos de cada card,
 * com animação nas barras. Chamado a cada troca de ciclo (5min).
 */
function refreshAllCardValues(animate) {
  const games = getGames();
  document.querySelectorAll('.game-card-v2').forEach(card => {
    const id = parseInt(card.dataset.gameId, 10);
    const g = games.find(x => x.id === id);
    if (!g) return;
    const d = computeDynamicValues(g);

    // Textos
    const set = (sel, v) => { const el = card.querySelector(`[data-v="${sel}"]`); if (el) el.textContent = v; };
    set('padrao', `${d.padrao}%`);
    set('minima', `${d.minima}%`);
    set('rtp', `${d.rtp}%`);
    set('pd', d.pd);
    set('mi', d.mi);
    set('mbc', d.mbc);
    set('mp', d.mp);
    set('timer', d.timer);

    // Barras (com transição CSS)
    const setBar = (sel, pct) => {
      const el = card.querySelector(`[data-v="${sel}"]`);
      if (!el) return;
      if (animate) el.classList.add('gcv2-bar-refresh');
      el.style.width = `${pct}%`;
      if (animate) setTimeout(() => el.classList.remove('gcv2-bar-refresh'), 800);
    };
    setBar('padrao-bar', d.padrao);
    setBar('minima-bar', d.minima);
    setBar('rtp-bar', d.rtp);

    // Atualiza também o badge de RTP topo
    const rtpTop = card.querySelector('.gcv2-rtp-badge strong');
    if (rtpTop) rtpTop.textContent = `${d.rtp}%`;
  });

  // Atualiza o timestamp global na grid
  updateLastUpdated();
}

/* ============================================
   LINKS DE AFILIADO — distribuição dinâmica
   Cada jogo é associado consistentemente a um dos links da lista.
   Quando o usuário entrar, cada card aponta para uma casa diferente,
   balanceando o tráfego entre todas as afiliadas.
   ============================================ */
const AFFILIATE_LINKS = [
  'https://www.fy-fanta.com/?id=223975751',
  'https://hms-tiradentesday.bet/?invite_code=8be79469',
  'https://coroa-gghhpg.com/?id=405842843',
  'https://www.onebra77.com/?source_code=TWMWECDNJ2X',
  'https://br.mt-antilope.com/home?inviteCode=VEU6ZR',
  'https://kk-judy777.vip/?id=649076826&currency=BRL&type=2'
];

function assignTestLinks() {
  const games = getGames();
  let changed = false;

  // Lista de URLs que são consideradas "placeholder" e devem ser substituídas
  const isPlaceholder = (link) => {
    if (!link || !link.trim()) return true;
    return link.includes('example.com') ||
           link.includes('/demo/slot-') ||
           link.trim() === '#';
  };

  games.forEach((g, i) => {
    if (isPlaceholder(g.link)) {
      // Distribuição determinística: cada jogo sempre pega o mesmo link
      // (baseado no id), mantendo a rotação entre as 6 casas
      const linkIndex = (g.id - 1) % AFFILIATE_LINKS.length;
      g.link = AFFILIATE_LINKS[linkIndex];
      changed = true;
    }
  });

  if (changed) saveGames(games);
}

if (document.getElementById('cardsGrid')) {
  document.addEventListener('DOMContentLoaded', initMain);
}

/* ============================================
   ======== ADMIN ==========================
   ============================================ */

function initAdminLogin() {
  const loginSection = document.getElementById('loginSection');
  const adminApp = document.getElementById('adminApp');
  if (!loginSection || !adminApp) return;

  const showApp = () => {
    loginSection.style.display = 'none';
    adminApp.style.display = 'flex';
    renderDashboard();
  };
  const showLogin = () => {
    loginSection.style.display = 'flex';
    adminApp.style.display = 'none';
  };
  const checkAuth = () => isLoggedIn() ? (showApp(), refreshSession()) : showLogin();

  ['click','keydown','mousemove'].forEach(ev =>
    document.addEventListener(ev, refreshSession, { passive: true })
  );

  setInterval(() => {
    if (!isLoggedIn() && adminApp.style.display !== 'none') {
      showLogin();
      showToast('Sessão expirada. Faça login novamente.', 'error');
    }
  }, 60000);

  const loginBtn = document.getElementById('loginBtn');
  const loginError = document.getElementById('loginError');
  const lockoutMsg = document.getElementById('lockoutMsg');
  let lockoutTimer;

  function updateLockoutUI() {
    if (!isLockedOut()) {
      if (lockoutMsg) lockoutMsg.style.display = 'none';
      if (loginBtn) loginBtn.disabled = false;
      return;
    }
    const remaining = Math.ceil(lockoutRemainingMs() / 60000);
    if (lockoutMsg) {
      lockoutMsg.textContent = `🔒 Conta bloqueada por ${remaining} min.`;
      lockoutMsg.style.display = 'block';
    }
    if (loginBtn) loginBtn.disabled = true;
    clearInterval(lockoutTimer);
    lockoutTimer = setInterval(() => {
      if (!isLockedOut()) { clearInterval(lockoutTimer); updateLockoutUI(); }
      else {
        const r = Math.ceil(lockoutRemainingMs() / 60000);
        if (lockoutMsg) lockoutMsg.textContent = `🔒 Conta bloqueada por ${r} min.`;
      }
    }, 1000);
  }
  updateLockoutUI();

  loginBtn?.addEventListener('click', async () => {
    if (isLockedOut()) { updateLockoutUI(); return; }
    const u = document.getElementById('adminUser')?.value.trim() || '';
    const p = document.getElementById('adminPass')?.value || '';
    loginBtn.disabled = true;
    loginBtn.textContent = 'Verificando...';

    if (!u || !p) {
      if (loginError) { loginError.textContent = 'Preencha todos os campos.'; loginError.style.display = 'block'; }
      loginBtn.disabled = false;
      loginBtn.textContent = 'Entrar';
      return;
    }

    const ok = await verifyLogin(u, p);
    if (ok) {
      resetLoginAttempts();
      if (loginError) loginError.style.display = 'none';
      createSession(generateToken(), Date.now() + SESSION_DURATION_MS);
      checkAuth();
    } else {
      const attempts = bumpLoginAttempts();
      const remaining = MAX_LOGIN_ATTEMPTS - attempts;
      const msg = remaining > 0
        ? `Usuário ou senha incorretos. ${remaining} tentativa(s) restante(s).`
        : 'Usuário ou senha incorretos.';
      if (loginError) { loginError.textContent = msg; loginError.style.display = 'block'; }
      updateLockoutUI();
      loginBtn.disabled = false;
      loginBtn.textContent = 'Entrar';
    }
  });

  document.getElementById('adminPass')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !loginBtn.disabled) loginBtn.click();
  });
  document.getElementById('adminUser')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('adminPass')?.focus();
  });

  document.getElementById('logoutBtn')?.addEventListener('click', () => {
    clearSession();
    showLogin();
    showToast('Sessão encerrada.', 'default');
  });

  checkAuth();
}

/* ---- ADMIN NAV ---- */
function showAdminPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));

  const pageEl = document.getElementById(`page-${page}`);
  if (pageEl) pageEl.classList.add('active');
  const sideEl = document.querySelector(`.sidebar-item[data-page="${page}"]`);
  if (sideEl) sideEl.classList.add('active');

  const titles = {
    dashboard: 'Painel Geral',
    insights:  'Insights Avançados',
    jogos:     'Gerenciar Jogos',
    social:    'Links Sociais',
    settings:  'Configurações',
  };
  const t = document.getElementById('pageTitle');
  if (t) t.textContent = titles[page] || page;

  switch (page) {
    case 'dashboard': renderDashboard(); break;
    case 'insights':  renderInsightsPage(); break;
    case 'jogos':     renderCardsConfig(); break;
    case 'social':    renderSocialConfig(); break;
    case 'settings':  renderSettingsPage(); break;
  }
}
window.showAdminPage = showAdminPage;

function initAdmin() {
  if (!document.getElementById('adminApp')) return;
  initAdminLogin();

  document.querySelectorAll('.sidebar-item[data-page]').forEach(item => {
    item.addEventListener('click', () => {
      showAdminPage(item.dataset.page);
      document.getElementById('sidebar')?.classList.remove('open');
      document.getElementById('sidebarOverlay')?.classList.remove('show');
    });
  });

  document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('open');
    document.getElementById('sidebarOverlay')?.classList.toggle('show');
  });
  document.getElementById('sidebarOverlay')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.remove('open');
    document.getElementById('sidebarOverlay')?.classList.remove('show');
  });

  // Session info
  setInterval(() => {
    const el = document.getElementById('sessionInfo');
    if (!el) return;
    if (isLoggedIn()) {
      const s = getSession();
      const remain = Math.max(0, Math.floor((s.expires - Date.now()) / 60000));
      el.textContent = `Sessão: ${remain} min restantes`;
    }
  }, 15000);
}

/* ============================================
   DASHBOARD
   ============================================ */
function renderDashboard() {
  renderStatsCards();
  renderTopGamesTable();
  renderProviderChart();
  renderHotRanking();
}

function renderStatsCards() {
  const games = getGames();
  const totalClicks = games.reduce((s,g) => s+(g.clicks||0), 0);
  const sorted = [...games].sort((a,b) => (b.clicks||0)-(a.clicks||0));
  const top = sorted[0];
  const hotCount = games.filter(g => g.hot === 'fire').length;
  const withLink = games.filter(g => g.link && g.link.trim() && g.link.trim() !== '#').length;

  const el = document.getElementById('statsCards');
  if (!el) return;
  el.innerHTML = `
    <div class="stat-card">
      <div class="stat-card-icon" style="background:linear-gradient(135deg,#F472B6,#EC4899)">🎮</div>
      <div class="stat-card-label">Total de Jogos</div>
      <div class="stat-card-value">${games.length}</div>
      <div class="stat-card-delta">${withLink} com link ativo</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon" style="background:linear-gradient(135deg,#C084FC,#9333EA)">👆</div>
      <div class="stat-card-label">Total de Cliques</div>
      <div class="stat-card-value">${totalClicks.toLocaleString('pt-BR')}</div>
      <div class="stat-card-delta">Acumulado histórico</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon" style="background:linear-gradient(135deg,#FBBF24,#F59E0B)">🔥</div>
      <div class="stat-card-label">Jogo Top</div>
      <div class="stat-card-value sm">${top?.clicks ? sanitize(top.emoji + ' ' + top.name) : '—'}</div>
      <div class="stat-card-delta">${top?.clicks || 0} cliques</div>
    </div>
    <div class="stat-card">
      <div class="stat-card-icon" style="background:linear-gradient(135deg,#F87171,#EF4444)">⚡</div>
      <div class="stat-card-label">Slots Quentes</div>
      <div class="stat-card-value">${hotCount}</div>
      <div class="stat-card-delta">Marcados como 🔥</div>
    </div>
  `;
}

function renderTopGamesTable() {
  const games = [...getGames()].sort((a,b) => (b.clicks||0)-(a.clicks||0)).slice(0,10);
  const el = document.getElementById('topGamesTable');
  if (!el) return;
  if (!games.length) { el.innerHTML = '<div class="empty">Nenhum jogo.</div>'; return; }
  const topClicks = games[0]?.clicks || 1;
  el.innerHTML = `
    <table class="data-table">
      <thead><tr><th>#</th><th>Jogo</th><th>Provedor</th><th>RTP</th><th>Cliques</th><th style="min-width:120px">Performance</th></tr></thead>
      <tbody>
        ${games.map((g,i) => {
          const pct = Math.max(4, Math.round(((g.clicks||0) / topClicks) * 100));
          return `
          <tr>
            <td><span class="rank-badge rank-${i<3?i+1:'n'}">${i===0?'🥇':i===1?'🥈':i===2?'🥉':i+1}</span></td>
            <td><strong>${sanitize(g.emoji||'🎰')} ${sanitize(g.name)}</strong></td>
            <td><span class="provider-tag prov-${g.provider}">${sanitize(PROVIDER_META[g.provider]?.name || g.provider)}</span></td>
            <td>${g.dist}%</td>
            <td><span class="badge-clicks">${g.clicks||0}</span></td>
            <td><div class="perf-bar"><div class="perf-fill" style="width:${pct}%"></div></div></td>
          </tr>
        `}).join('')}
      </tbody>
    </table>
  `;
}

function renderProviderChart() {
  const games = getGames();
  const byProv = { pgsoft:0, pragmatic:0, wg:0 };
  const clicksByProv = { pgsoft:0, pragmatic:0, wg:0 };
  games.forEach(g => {
    if (byProv.hasOwnProperty(g.provider)) {
      byProv[g.provider]++;
      clicksByProv[g.provider] += (g.clicks||0);
    }
  });

  const el = document.getElementById('providerChart');
  if (!el) return;
  const total = games.length || 1;
  el.innerHTML = Object.entries(byProv).map(([p,n]) => {
    const pct = Math.round((n / total) * 100);
    const m = PROVIDER_META[p];
    return `
      <div class="donut-item">
        <div class="donut-head">
          <span class="donut-dot" style="background:${m.color}"></span>
          <span class="donut-name">${m.name}</span>
          <span class="donut-count">${n} jogos</span>
        </div>
        <div class="donut-track"><div class="donut-fill" style="width:${pct}%;background:linear-gradient(90deg, ${m.color}, ${m.color}dd)"></div></div>
        <div class="donut-meta">${clicksByProv[p]} cliques · ${pct}% do catálogo</div>
      </div>
    `;
  }).join('');
}

function renderHotRanking() {
  const el = document.getElementById('hotRanking');
  if (!el) return;
  const hot = getGames().filter(g => g.hot === 'fire').slice(0, 6);
  if (!hot.length) { el.innerHTML = '<div class="empty">Nenhum jogo quente ativo.</div>'; return; }
  el.innerHTML = hot.map(g => `
    <div class="hot-item">
      <div class="hot-emoji">${g.emoji||'🎰'}</div>
      <div class="hot-info">
        <div class="hot-name">${sanitize(g.name)}</div>
        <div class="hot-prov">${PROVIDER_META[g.provider]?.name || g.provider} · RTP ${g.dist}%</div>
      </div>
      <div class="hot-clicks">${g.clicks||0} <small>cliques</small></div>
    </div>
  `).join('');
}

/* ============================================
   INSIGHTS (avançado)
   ============================================ */
function renderInsightsPage() {
  const el = document.getElementById('insightsContent');
  if (!el) return;

  const games = getGames();
  const totalClicks = games.reduce((s,g) => s+(g.clicks||0), 0);
  const avgRtp = (games.reduce((s,g) => s+(g.rtp||g.dist||0), 0) / (games.length || 1)).toFixed(2);
  const highRtp = games.filter(g => (g.rtp||g.dist) >= 97).length;
  const noClick = games.filter(g => (g.clicks||0) === 0).length;

  // Distribuição de RTP por faixa
  const rtpBuckets = { '95–95.9':0, '96–96.5':0, '96.5–97':0, '97+':0 };
  games.forEach(g => {
    const r = g.rtp || g.dist || 0;
    if (r < 96) rtpBuckets['95–95.9']++;
    else if (r < 96.5) rtpBuckets['96–96.5']++;
    else if (r < 97) rtpBuckets['96.5–97']++;
    else rtpBuckets['97+']++;
  });
  const maxBucket = Math.max(...Object.values(rtpBuckets), 1);

  // Top provedor por cliques
  const provClicks = {};
  games.forEach(g => { provClicks[g.provider] = (provClicks[g.provider]||0) + (g.clicks||0); });
  const topProv = Object.entries(provClicks).sort((a,b) => b[1]-a[1])[0] || [];

  // CTR estimado (jogos com link vs total cliques)
  const withLink = games.filter(g => g.link && g.link.trim() && g.link.trim() !== '#').length;

  el.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-card-icon" style="background:linear-gradient(135deg,#A78BFA,#8B5CF6)">📊</div>
        <div class="stat-card-label">RTP Médio do Catálogo</div>
        <div class="stat-card-value">${avgRtp}%</div>
        <div class="stat-card-delta">${highRtp} jogos acima de 97%</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon" style="background:linear-gradient(135deg,#FB7185,#E11D48)">🏆</div>
        <div class="stat-card-label">Provedor Líder (cliques)</div>
        <div class="stat-card-value sm">${PROVIDER_META[topProv[0]]?.name || '—'}</div>
        <div class="stat-card-delta">${topProv[1]||0} cliques</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon" style="background:linear-gradient(135deg,#60A5FA,#3B82F6)">🔗</div>
        <div class="stat-card-label">Cobertura de Links</div>
        <div class="stat-card-value">${Math.round((withLink/(games.length||1))*100)}%</div>
        <div class="stat-card-delta">${withLink}/${games.length} jogos linkados</div>
      </div>
      <div class="stat-card">
        <div class="stat-card-icon" style="background:linear-gradient(135deg,#FBBF24,#D97706)">💤</div>
        <div class="stat-card-label">Jogos sem Engajamento</div>
        <div class="stat-card-value">${noClick}</div>
        <div class="stat-card-delta">Considere promover ou remover</div>
      </div>
    </div>

    <div class="admin-panel">
      <h3>🎯 Distribuição de RTP</h3>
      <p class="panel-sub">Quantos jogos do catálogo estão em cada faixa de RTP</p>
      <div class="rtp-buckets">
        ${Object.entries(rtpBuckets).map(([label, n]) => `
          <div class="rtp-bucket">
            <div class="bucket-label">${label}%</div>
            <div class="bucket-bar">
              <div class="bucket-fill" style="width:${(n/maxBucket*100)}%"></div>
            </div>
            <div class="bucket-count">${n}</div>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="admin-panel">
      <h3>🔥 Top 5 Jogos que Mais Convertem</h3>
      <p class="panel-sub">Ranqueados pelo total de cliques no botão "Jogar"</p>
      <div class="top-convert">
        ${[...games].sort((a,b)=>(b.clicks||0)-(a.clicks||0)).slice(0,5).map((g,i) => `
          <div class="convert-item">
            <div class="convert-rank">${i+1}</div>
            <div class="convert-emoji">${g.emoji||'🎰'}</div>
            <div class="convert-info">
              <div class="convert-name">${sanitize(g.name)}</div>
              <div class="convert-meta">${PROVIDER_META[g.provider]?.name || g.provider} · RTP ${g.dist}%</div>
            </div>
            <div class="convert-clicks">
              <span class="big">${g.clicks||0}</span>
              <span class="sm">${totalClicks ? ((g.clicks||0)/totalClicks*100).toFixed(1) : 0}% do total</span>
            </div>
          </div>
        `).join('')}
        ${!totalClicks ? '<div class="empty">Ainda não há cliques registrados. Compartilhe o site para começar!</div>' : ''}
      </div>
    </div>

    <div class="admin-panel">
      <h3>📉 Jogos com Menor Performance</h3>
      <p class="panel-sub">Considere atualizar links, imagem ou marcar como destaque</p>
      <div class="low-perf">
        ${[...games].filter(g => (g.clicks||0) === 0).slice(0,6).map(g => `
          <div class="low-item">
            <span class="low-emoji">${g.emoji||'🎰'}</span>
            <span class="low-name">${sanitize(g.name)}</span>
            <span class="low-tag ${g.link ? 'ok' : 'warn'}">${g.link ? 'Com link' : 'Sem link'}</span>
          </div>
        `).join('') || '<div class="empty">Todos os jogos têm engajamento! 🎉</div>'}
      </div>
    </div>
  `;
}

/* ============================================
   SOCIAL CONFIG
   ============================================ */
function renderSocialConfig() {
  const s = getSocial();
  const el = document.getElementById('socialConfigForm');
  if (!el) return;
  el.innerHTML = `
    <div class="social-config">
      <div class="social-input-row">
        <label><span class="ig-ico">📸</span> Instagram</label>
        <input class="form-input" id="cfg-ig" type="url" placeholder="https://instagram.com/seu_perfil" value="${sanitize(s.ig !== '#' ? s.ig : '')}">
      </div>
      <div class="social-input-row">
        <label><span class="tg-ico">✈️</span> Telegram</label>
        <input class="form-input" id="cfg-tg" type="url" placeholder="https://t.me/seu_canal" value="${sanitize(s.tg !== '#' ? s.tg : '')}">
      </div>
      <div class="social-input-row">
        <label><span class="wa-ico">💬</span> WhatsApp</label>
        <input class="form-input" id="cfg-wa" type="url" placeholder="https://wa.me/55DDNUMERO" value="${sanitize(s.wa !== '#' ? s.wa : '')}">
      </div>
      <div class="actions-row">
        <button class="btn-save" id="saveSocialBtn">💾 Salvar Links</button>
        <span class="success-msg" id="socialSaved">✅ Salvo!</span>
      </div>
    </div>

    <div class="admin-panel" style="margin-top:24px">
      <h3>🎨 Prévia dos Botões</h3>
      <p class="panel-sub">Veja como os botões aparecem no site público</p>
      <div class="social-preview">
        <a class="social-preview-btn ig"><span>📸</span> Instagram</a>
        <a class="social-preview-btn tg"><span>✈️</span> Telegram</a>
        <a class="social-preview-btn wa"><span>💬</span> WhatsApp</a>
      </div>
    </div>
  `;
  document.getElementById('saveSocialBtn')?.addEventListener('click', () => {
    const ig = document.getElementById('cfg-ig').value.trim() || '#';
    const tg = document.getElementById('cfg-tg').value.trim() || '#';
    const wa = document.getElementById('cfg-wa').value.trim() || '#';
    saveSocial({ ig, tg, wa });
    applySocialLinks();
    const msg = document.getElementById('socialSaved');
    if (msg) { msg.style.display = 'inline-block'; setTimeout(() => msg.style.display = 'none', 2500); }
    showToast('Links salvos com sucesso!', 'success');
  });
}

/* ============================================
   CARDS CONFIG (GERENCIAR JOGOS)
   ============================================ */
let cardsFilterProvider = 'all';
let cardsSearchQuery = '';

function renderCardsConfig() {
  const games = getGames();
  const el = document.getElementById('cardsConfigList');
  const headerEl = document.getElementById('cardsConfigHeader');
  if (!el) return;

  // Header com filtros
  if (headerEl) {
    const counts = { all: games.length };
    Object.keys(PROVIDER_META).forEach(p => { counts[p] = games.filter(g => g.provider === p).length; });
    headerEl.innerHTML = `
      <div class="config-filters">
        <input type="text" id="cardsSearch" class="form-input" placeholder="🔍 Buscar jogo..." value="${sanitize(cardsSearchQuery)}">
        <div class="filter-chips">
          <button class="chip ${cardsFilterProvider==='all'?'active':''}" data-p="all">Todos <span>${counts.all}</span></button>
          <button class="chip ${cardsFilterProvider==='pgsoft'?'active':''}" data-p="pgsoft">PG Soft <span>${counts.pgsoft||0}</span></button>
          <button class="chip ${cardsFilterProvider==='pragmatic'?'active':''}" data-p="pragmatic">Pragmatic <span>${counts.pragmatic||0}</span></button>
          <button class="chip ${cardsFilterProvider==='wg'?'active':''}" data-p="wg">WG Casino <span>${counts.wg||0}</span></button>
        </div>
      </div>
    `;
    headerEl.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
      cardsFilterProvider = c.dataset.p;
      renderCardsConfig();
    }));
    let t;
    document.getElementById('cardsSearch')?.addEventListener('input', function() {
      clearTimeout(t);
      t = setTimeout(() => { cardsSearchQuery = this.value.trim(); renderCardsConfig(); }, 250);
    });
  }

  // Filtered list
  let list = cardsFilterProvider === 'all' ? games : games.filter(g => g.provider === cardsFilterProvider);
  if (cardsSearchQuery) {
    const q = cardsSearchQuery.toLowerCase();
    list = list.filter(g => g.name.toLowerCase().includes(q));
  }

  if (!list.length) {
    el.innerHTML = '<div class="empty">Nenhum jogo encontrado com esse filtro.</div>';
    return;
  }

  el.innerHTML = list.map(g => {
    const thumb = resolveThumbnail(g);
    return `
      <div class="card-config-item" data-id="${g.id}">
        <div class="card-config-thumb-wrap">
          <img src="${sanitize(thumb)}" class="card-config-thumb" alt="">
        </div>
        <div class="card-config-body">
          <div class="card-config-top">
            <div>
              <div class="card-config-name">${sanitize(g.name)}</div>
              <div class="card-config-sub">
                <span class="provider-tag prov-${g.provider}">${PROVIDER_META[g.provider]?.name || g.provider}</span>
                <span>RTP ${g.dist}%</span>
                <span>${g.clicks||0} cliques</span>
              </div>
            </div>
            <button class="btn-remove" data-id="${g.id}">✕</button>
          </div>
          <div class="card-config-fields">
            <div class="field-group field-group--full">
              <label>🔗 Link do Jogo</label>
              <input type="url" class="f-link" value="${sanitize(g.link||'')}" placeholder="https://... cole aqui o link de afiliado">
            </div>
            <div class="field-group field-group--full">
              <label>🖼️ Imagem Customizada (opcional — deixe vazio para usar thumbnail padrão)</label>
              <input type="url" class="f-img" value="${sanitize(g.img||'')}" placeholder="https://... URL da imagem oficial">
            </div>
            <div class="field-group">
              <label>Nome</label>
              <input type="text" class="f-name" value="${sanitize(g.name)}">
            </div>
            <div class="field-group">
              <label>Provedor</label>
              <select class="f-provider">
                ${Object.entries(PROVIDER_META).map(([v,m]) =>
                  `<option value="${v}" ${g.provider===v?'selected':''}>${m.name}</option>`
                ).join('')}
              </select>
            </div>
            <div class="field-group">
              <label>RTP %</label>
              <input type="number" class="f-dist" min="50" max="100" step="0.01" value="${g.rtp || g.dist}">
            </div>
            <div class="field-group">
              <label>Status</label>
              <select class="f-hot">
                <option value="fire" ${g.hot==='fire'?'selected':''}>🔥 Quente</option>
                <option value="cold" ${g.hot==='cold'?'selected':''}>✨ Normal</option>
              </select>
            </div>
            <div class="field-group">
              <label>Emoji</label>
              <input type="text" class="f-emoji" value="${g.emoji||'🎰'}" maxlength="4">
            </div>
            <div class="field-group">
              <label>Tag (opcional)</label>
              <input type="text" class="f-tag" value="${sanitize(g.tag||'')}" placeholder="Ex: Tigrinho">
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Autosave
  el.querySelectorAll('.card-config-item').forEach(item => {
    // Fallback de imagem no admin também
    const itemId = parseInt(item.dataset.id, 10);
    const itemGame = list.find(g => g.id === itemId);
    const thumbEl = item.querySelector('.card-config-thumb');
    if (thumbEl && itemGame) attachImgFallback(thumbEl, itemGame);

    let saveTimer;
    item.querySelectorAll('input,select').forEach(input => {
      input.addEventListener('change', () => {
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => saveCardFromItem(item), 300);
      });
    });
    item.querySelector('.f-link')?.addEventListener('input', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => saveCardFromItem(item), 500);
    });
  });

  el.querySelectorAll('.btn-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Remover este jogo do catálogo?')) return;
      const id = parseInt(btn.dataset.id);
      saveGames(getGames().filter(g => g.id !== id));
      renderCardsConfig();
      renderStatsCards();
      showToast('Jogo removido.', 'default');
    });
  });
}

function saveCardFromItem(item) {
  const id = parseInt(item.dataset.id);
  const games = getGames();
  const g = games.find(x => x.id === id);
  if (!g) return;
  g.name   = item.querySelector('.f-name')?.value || g.name;
  g.emoji  = item.querySelector('.f-emoji')?.value || '🎰';
  g.link   = item.querySelector('.f-link')?.value.trim() || '';
  g.img    = item.querySelector('.f-img')?.value.trim() || '';
  g.provider = item.querySelector('.f-provider')?.value || g.provider;
  const rtpVal = parseFloat(item.querySelector('.f-dist')?.value) || g.dist;
  g.rtp = Math.min(100, Math.max(50, rtpVal));
  g.dist = Math.round(g.rtp);
  g.hot = item.querySelector('.f-hot')?.value || g.hot;
  g.tag = item.querySelector('.f-tag')?.value || '';
  saveGames(games);
  item.classList.add('saved-flash');
  setTimeout(() => item.classList.remove('saved-flash'), 700);
}

window.addNewCard = function() {
  const games = getGames();
  const newId = Math.max(...games.map(g => g.id || 0), 0) + 1;
  games.unshift({
    id: newId,
    name: 'Novo Jogo',
    provider: 'pgsoft',
    emoji: '🎰',
    theme: 'chinese',
    img: '',
    link: '',
    dist: 96,
    rtp: 96,
    minBet: 80,
    maxBet: 70,
    hot: 'cold',
    tag: '',
    clicks: 0,
  });
  saveGames(games);
  renderCardsConfig();
  showToast('Novo jogo adicionado!', 'success');
  setTimeout(() => {
    document.getElementById('cardsConfigList')?.firstElementChild?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 100);
};

window.resetClicks = function() {
  if (!confirm('Zerar TODOS os cliques? Esta ação não pode ser desfeita.')) return;
  const games = getGames().map(g => ({ ...g, clicks: 0 }));
  saveGames(games);
  renderDashboard();
  showToast('Cliques zerados!', 'default');
};

window.restoreCatalog = function() {
  if (!confirm('Restaurar catálogo completo de fábrica? Todos os links e personalizações serão perdidos.')) return;
  localStorage.removeItem(STORAGE_KEYS.GAMES);
  getGames(); // rebuild
  renderCardsConfig();
  renderDashboard();
  showToast('Catálogo restaurado!', 'success');
};

/* ============================================
   SETTINGS
   ============================================ */
/* ============================================
   UI DE GERENCIAMENTO DE USUÁRIOS
   ============================================ */

function renderCurrentUserCard() {
  const user = getCurrentUser();
  if (!user) return '';
  const role = ROLES[user.role] || { label: '❓ Sem perfil', color: '#94A3B8' };
  return `
    <div class="admin-panel" style="background: linear-gradient(135deg, rgba(139,92,246,0.08), rgba(236,72,153,0.05)); border-left: 4px solid ${role.color};">
      <h3>👤 Sua Sessão</h3>
      <div style="display: flex; align-items: center; gap: 16px; flex-wrap: wrap;">
        <div style="font-size: 1.1rem; font-weight: 600; color: #F1F5F9;">
          ${sanitize(user.username)}
          ${user.isRoot ? '<span style="font-size:0.7rem; background: #EAB308; color: #422006; padding: 2px 8px; border-radius: 4px; margin-left: 6px;">ROOT</span>' : ''}
        </div>
        <div style="background: ${role.color}22; color: ${role.color}; padding: 4px 12px; border-radius: 999px; font-size: 0.82rem; font-weight: 600; border: 1px solid ${role.color}44;">
          ${role.label}
        </div>
      </div>
    </div>
  `;
}

function renderUsersPanel() {
  const users = getUsers();
  const current = getCurrentUser();

  const userRows = users.map(u => {
    const role = ROLES[u.role] || { label: '?', color: '#94A3B8' };
    const isMe = current && current.id === u.id;
    const lastLogin = u.lastLogin ? new Date(u.lastLogin).toLocaleString('pt-BR') : 'Nunca';
    return `
      <div style="display: grid; grid-template-columns: 1fr auto auto auto; gap: 10px; align-items: center; padding: 10px 12px; background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.05); border-radius: 8px; margin-bottom: 8px;">
        <div>
          <div style="font-weight: 600; color: #F1F5F9;">
            ${sanitize(u.username)}
            ${u.isRoot ? '<span style="font-size:0.7rem; background: #EAB308; color: #422006; padding: 1px 6px; border-radius: 4px; margin-left: 4px;">ROOT</span>' : ''}
            ${isMe ? '<span style="font-size:0.7rem; background: #22c55e33; color: #4ADE80; padding: 1px 6px; border-radius: 4px; margin-left: 4px;">VOCÊ</span>' : ''}
          </div>
          <div style="font-size: 0.78rem; color: #94A3B8; margin-top: 2px;">Último login: ${lastLogin}</div>
        </div>
        <div style="background: ${role.color}22; color: ${role.color}; padding: 4px 10px; border-radius: 999px; font-size: 0.78rem; font-weight: 600; border: 1px solid ${role.color}44;">
          ${role.label}
        </div>
        <button class="btn-save btn-secondary" style="padding: 6px 12px; font-size: 0.82rem;" data-edituser="${u.id}">✏️ Editar</button>
        ${u.isRoot ? `<div style="font-size: 0.75rem; color: #94A3B8; padding: 6px 12px;">🔒 Protegido</div>` :
          `<button class="btn-save btn-danger" style="padding: 6px 12px; font-size: 0.82rem;" data-deleteuser="${u.id}">🗑️</button>`}
      </div>
    `;
  }).join('');

  return `
    <div class="admin-panel">
      <h3>👥 Usuários & Perfis</h3>
      <p class="panel-sub">Gerencie quem tem acesso ao painel e com qual nível de permissão.</p>

      <div style="margin-bottom: 16px;">
        ${userRows}
      </div>

      <details style="margin-bottom: 12px;">
        <summary style="cursor: pointer; color: #A78BFA; font-weight: 600; padding: 8px 0;">➕ Criar novo usuário</summary>
        <div class="form-stack" style="margin-top: 12px; padding: 14px; background: rgba(139,92,246,0.05); border-radius: 8px;">
          <div class="form-group">
            <label class="form-label">Nome de usuário</label>
            <input class="form-input" id="newUsername" type="text" placeholder="ex: maria">
          </div>
          <div class="form-group">
            <label class="form-label">Senha inicial (mínimo 8 caracteres)</label>
            <input class="form-input" id="newUserPass" type="password" placeholder="Senha temporária">
          </div>
          <div class="form-group">
            <label class="form-label">Perfil</label>
            <select class="form-input" id="newUserRole">
              <option value="editor">✏️ Editor — edita jogos, não mexe em usuários</option>
              <option value="viewer">👁️ Visualizador — só vê dashboards</option>
              <option value="super_admin">👑 Super Admin — acesso total</option>
            </select>
          </div>
          <div class="actions-row">
            <button class="btn-save" id="btnCreateUser">➕ Criar Usuário</button>
          </div>
          <div id="newUserMsg" style="display:none; padding: 10px; border-radius: 8px; font-size: 0.9rem;"></div>
        </div>
      </details>

      <details>
        <summary style="cursor: pointer; color: #94A3B8; font-weight: 600; padding: 8px 0; font-size: 0.88rem;">ℹ️ Sobre os perfis</summary>
        <div style="margin-top: 10px; padding: 14px; background: rgba(255,255,255,0.02); border-radius: 8px; font-size: 0.85rem; line-height: 1.6;">
          <div style="margin-bottom: 10px;">
            <strong style="color: #F59E0B;">👑 Super Admin</strong>: ${ROLES.super_admin.description}
          </div>
          <div style="margin-bottom: 10px;">
            <strong style="color: #3B82F6;">✏️ Editor</strong>: ${ROLES.editor.description}
          </div>
          <div>
            <strong style="color: #10B981;">👁️ Visualizador</strong>: ${ROLES.viewer.description}
          </div>
          <div style="margin-top: 14px; padding: 10px; background: rgba(234,179,8,0.1); border-left: 3px solid #EAB308; border-radius: 4px;">
            🛡️ <strong>O usuário "admin" (root) nunca pode ser deletado</strong> — isso garante que você sempre terá acesso ao painel, mesmo se outros usuários forem removidos.
          </div>
        </div>
      </details>
    </div>
  `;
}

function renderSettingsPage() {
  const el = document.getElementById('settingsPageContent');
  if (!el) return;
  const games = getGames();
  const currentUser = getCurrentUser();
  const canManageUsers = hasPermission(currentUser, 'manage_users');

  el.innerHTML = `
    ${renderCurrentUserCard()}
    ${canManageUsers ? renderUsersPanel() : ''}

    <div class="admin-panel">
      <h3>🔐 Segurança</h3>
      <p class="panel-sub">Altere suas credenciais de acesso ao painel administrativo</p>
      <div class="form-stack">
        <div class="form-group">
          <label class="form-label">Novo Usuário</label>
          <input class="form-input" id="newUser" type="text" placeholder="Novo nome de usuário" autocomplete="username">
        </div>
        <div class="form-group">
          <label class="form-label">Senha Atual</label>
          <input class="form-input" id="currentPass" type="password" placeholder="Digite sua senha atual" autocomplete="current-password">
        </div>
        <div class="form-group">
          <label class="form-label">Nova Senha (mínimo 8 caracteres)</label>
          <input class="form-input" id="newPass" type="password" placeholder="Nova senha" autocomplete="new-password">
          <div class="password-strength"><div class="password-strength-bar" id="pwdStrengthBar"></div></div>
        </div>
        <div class="form-group">
          <label class="form-label">Confirmar Nova Senha</label>
          <input class="form-input" id="confirmPass" type="password" placeholder="Confirme a nova senha" autocomplete="new-password">
        </div>
        <button class="btn-save" id="btnChangePwd">🔐 Alterar Credenciais</button>
        <span class="success-msg" id="pwdMsg"></span>
      </div>
    </div>

    <div class="admin-panel">
      <h3>💾 Backup & Restauração</h3>
      <p class="panel-sub">Exporte ou importe todas as configurações do site</p>
      <div class="actions-row">
        <button class="btn-save" id="btnExportData">📤 Exportar Dados</button>
        <label class="btn-save btn-secondary" style="cursor:pointer">📥 Importar Dados
          <input type="file" id="importFile" accept=".json" style="display:none">
        </label>
        <button class="btn-save btn-danger" id="btnResetAll">⚠️ Resetar Tudo</button>
      </div>
    </div>

    <div class="admin-panel">
      <h3>📦 Catálogo</h3>
      <p class="panel-sub">Gerencie o catálogo base de jogos</p>
      <div class="actions-row">
        <button class="btn-save" onclick="restoreCatalog()">🔄 Restaurar Catálogo Padrão</button>
        <button class="btn-save btn-secondary" onclick="resetClicks()">🗑️ Zerar Todos os Cliques</button>
      </div>
    </div>

    <div class="admin-panel" style="border: 2px dashed rgba(239, 68, 68, 0.4); background: linear-gradient(135deg, rgba(239,68,68,0.06), rgba(236,72,153,0.06));">
      <h3>🧹 Limpar Catálogo</h3>
      <p class="panel-sub">Use estas opções para remover jogos indesejados do catálogo. Útil quando seu catálogo tem jogos padrão que você não quer e prefere só os extraídos de um concorrente real.</p>
      <div class="actions-row">
        <button class="btn-save" id="btnKeepOnlyWithImg" style="background: linear-gradient(135deg, #10B981, #06B6D4);">🎯 Manter só os jogos com imagem oficial</button>
        <button class="btn-save btn-danger" id="btnClearCatalog">💣 Zerar TODOS os Jogos</button>
        <button class="btn-save btn-secondary" id="btnClearCatalogBackup">💾 Zerar (com Backup)</button>
      </div>
      <div id="clearCatalogMsg" style="display:none; padding: 10px; border-radius: 8px; font-size: 0.9rem; margin-top: 10px;"></div>
      <p class="panel-sub" style="margin-top: 12px; font-size: 0.82rem; opacity: 0.8;">
        💡 <strong>"Manter só os jogos com imagem oficial"</strong> é o que você quer se já rodou o script do concorrente e quer deixar só os jogos que realmente receberam capa. Jogos sem URL (que ainda mostram SVG padrão) são deletados.
      </p>
    </div>

    <div class="admin-panel">
      <h3>🖼️ URLs de Imagens em Massa</h3>
      <p class="panel-sub">Cole aqui no formato <code>Nome do Jogo | URL</code> (uma por linha) para aplicar em vários jogos de uma só vez. Jogos não listados ficam com o visual padrão.</p>
      <div class="form-stack">
        <textarea id="bulkImgInput" class="form-input" rows="12"
          placeholder="Fortune Tiger | https://site.com/imagens/fortune-tiger.png&#10;Gates of Olympus | https://site.com/imagens/gates-of-olympus.png&#10;Sweet Bonanza | https://site.com/imagens/sweet-bonanza.png"
          style="font-family: monospace; font-size: 0.85rem; min-height: 200px;"></textarea>
        <div class="actions-row">
          <button class="btn-save" id="btnBulkImgApply">✨ Aplicar URLs</button>
          <button class="btn-save" id="btnBulkImgApplyCreate" style="background: linear-gradient(135deg, #8B5CF6, #EC4899);">🎁 Aplicar + Criar Faltantes</button>
          <button class="btn-save btn-secondary" id="btnBulkImgExport">📤 Exportar URLs Atuais</button>
          <button class="btn-save btn-secondary" id="btnBulkImgClear">🗑️ Limpar Todas as URLs</button>
        </div>
        <div id="bulkImgMsg" style="display:none; padding: 10px; border-radius: 8px; font-size: 0.9rem;"></div>
      </div>
    </div>

    <div class="admin-panel">
      <h3>🔗 Links em Massa</h3>
      <p class="panel-sub">Mesmo formato: <code>Nome do Jogo | Link</code> (uma por linha). Útil quando você tem seus links de afiliado em planilha.</p>
      <div class="form-stack">
        <textarea id="bulkLinkInput" class="form-input" rows="10"
          placeholder="Fortune Tiger | https://casa-aposta.com/ref/SEU_ID/fortune-tiger&#10;Gates of Olympus | https://casa-aposta.com/ref/SEU_ID/gates-olympus"
          style="font-family: monospace; font-size: 0.85rem; min-height: 180px;"></textarea>
        <div class="actions-row">
          <button class="btn-save" id="btnBulkLinkApply">🔗 Aplicar Links</button>
          <button class="btn-save btn-secondary" id="btnBulkLinkExport">📤 Exportar Links Atuais</button>
        </div>
        <div id="bulkLinkMsg" style="display:none; padding: 10px; border-radius: 8px; font-size: 0.9rem;"></div>
      </div>
    </div>

    <div class="admin-panel">
      <h3>ℹ️ Informações</h3>
      <div class="info-grid">
        <div class="info-item"><span>Versão</span><strong>${APP_VERSION}</strong></div>
        <div class="info-item"><span>Total de Jogos</span><strong>${games.length}</strong></div>
        <div class="info-item"><span>PG Soft</span><strong>${games.filter(g=>g.provider==='pgsoft').length}</strong></div>
        <div class="info-item"><span>Pragmatic Play</span><strong>${games.filter(g=>g.provider==='pragmatic').length}</strong></div>
        <div class="info-item"><span>WG Casino</span><strong>${games.filter(g=>g.provider==='wg').length}</strong></div>
        <div class="info-item"><span>Com imagem oficial</span><strong>${games.filter(g => g.img && g.img.trim() && !g.img.startsWith('data:')).length}</strong></div>
        <div class="info-item"><span>Sem imagem (usam SVG)</span><strong>${games.filter(g => !g.img || !g.img.trim() || g.img.startsWith('data:')).length}</strong></div>
        <div class="info-item"><span>Tamanho em Storage</span><strong>${getStorageSize()} KB</strong></div>
      </div>
      <div class="actions-row" style="margin-top: 14px;">
        <button class="btn-save btn-secondary" id="btnTestImages">🧪 Testar se as URLs das imagens funcionam</button>
      </div>
      <div id="testImagesResult" style="display:none; padding: 14px; border-radius: 8px; margin-top: 12px; background: rgba(148,163,184,0.05); border: 1px solid rgba(148,163,184,0.2); font-size: 0.85rem; max-height: 400px; overflow-y: auto;"></div>
    </div>
  `;

  // Password strength
  document.getElementById('newPass')?.addEventListener('input', function() {
    const bar = document.getElementById('pwdStrengthBar');
    if (!bar) return;
    let score = 0;
    if (this.value.length >= 8) score++;
    if (/[A-Z]/.test(this.value)) score++;
    if (/[0-9]/.test(this.value)) score++;
    if (/[^A-Za-z0-9]/.test(this.value)) score++;
    const pct = (score / 4) * 100;
    const color = score <= 1 ? '#ef4444' : score === 2 ? '#f97316' : score === 3 ? '#eab308' : '#22c55e';
    bar.style.width = pct + '%';
    bar.style.background = color;
  });

  document.getElementById('btnChangePwd')?.addEventListener('click', async () => {
    const newUser = document.getElementById('newUser').value.trim();
    const currentPass = document.getElementById('currentPass').value;
    const newPass = document.getElementById('newPass').value;
    const confirmPass = document.getElementById('confirmPass').value;
    const msg = document.getElementById('pwdMsg');
    const setMsg = (txt, color) => {
      msg.textContent = txt;
      msg.style.display = 'block';
      msg.style.color = color;
    };

    if (!currentPass || !newPass) return setMsg('❌ Preencha senha atual e nova senha.', '#ef4444');
    if (newPass.length < 8) return setMsg('❌ Nova senha deve ter pelo menos 8 caracteres.', '#ef4444');
    if (newPass !== confirmPass) return setMsg('❌ Senhas não coincidem.', '#ef4444');

    const creds = getAdminCreds();
    const currentUser = creds.user || DEFAULT_CREDS.user;
    const ok = await verifyLogin(currentUser, currentPass);
    if (!ok) return setMsg('❌ Senha atual incorreta.', '#ef4444');

    const h = await hashString(newPass);
    saveAdminCreds(newUser || currentUser, h);
    setMsg('✅ Credenciais atualizadas! Faça login novamente.', '#22c55e');
    setTimeout(() => { clearSession(); location.reload(); }, 2000);
  });

  document.getElementById('btnExportData')?.addEventListener('click', () => {
    const data = {
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      games: getGames(),
      social: getSocial(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `slotmestre-backup-${Date.now()}.json`;
    a.click(); URL.revokeObjectURL(url);
    showToast('Backup exportado!', 'success');
  });

  document.getElementById('importFile')?.addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const data = JSON.parse(e.target.result);
        if (data.games) saveGames(data.games);
        if (data.social) saveSocial(data.social);
        showToast('Dados importados!', 'success');
        renderDashboard();
      } catch {
        showToast('Erro ao importar JSON.', 'error');
      }
    };
    reader.readAsText(file);
    this.value = '';
  });

  // ========= URLs em Massa =========
  const bulkMsg = (id, txt, color) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = txt;
    el.style.display = 'block';
    el.style.background = color === 'green' ? 'rgba(34,197,94,0.15)' : color === 'red' ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.15)';
    el.style.color = color === 'green' ? '#4ADE80' : color === 'red' ? '#F87171' : '#CBD5E1';
    el.style.border = `1px solid ${color === 'green' ? '#22c55e' : color === 'red' ? '#ef4444' : '#475569'}`;
  };

  // Normaliza nomes para casar jogos mesmo com variações:
  // "Fortune Tiger PG" ≈ "fortune tiger" ≈ "FORTUNE-TIGER" ≈ "Fortune  Tiger (Slot)"
  const normalizeName = (s) => {
    return String(s || '')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')     // remove acentos
      .replace(/[™®©]/g, '')                                  // remove símbolos de marca
      .replace(/\b(pg|pragmatic|pragmatic play|slot|slots|demo|by|the|pg soft|pgsoft|wgs|wg casino)\b/gi, '') // remove palavras genéricas
      .replace(/\([^)]*\)/g, '')                              // remove conteúdo entre parênteses
      .replace(/[^a-z0-9]+/g, ' ')                            // troca não-alfanumérico por espaço
      .replace(/\s+/g, ' ')                                   // colapsa espaços
      .trim();
  };

  const parseBulk = (text) => {
    const map = {};
    text.split('\n').forEach(line => {
      const parts = line.split('|').map(s => s.trim());
      if (parts.length >= 2 && parts[0] && parts[1]) {
        const key = normalizeName(parts[0]);
        if (key) map[key] = { original: parts[0], url: parts[1] };
      }
    });
    return map;
  };

  // Busca fuzzy: tenta achar um jogo no catálogo cujo nome normalizado
  // bata parcialmente com o nome vindo do bulk
  const findGameByFuzzyName = (games, normalizedBulkName) => {
    // 1. Match exato normalizado
    let found = games.find(g => normalizeName(g.name) === normalizedBulkName);
    if (found) return found;

    // 2. Nome do catálogo contido no do bulk (ex: "Fortune Tiger" em "Fortune Tiger PG")
    found = games.find(g => {
      const gn = normalizeName(g.name);
      return gn.length >= 5 && normalizedBulkName.includes(gn);
    });
    if (found) return found;

    // 3. Nome do bulk contido no do catálogo (ex: "Tiger" em "Fortune Tiger")
    //    — só se o do bulk tiver pelo menos 2 palavras pra evitar falsos positivos
    const words = normalizedBulkName.split(' ').filter(w => w.length > 2);
    if (words.length >= 2) {
      found = games.find(g => {
        const gn = normalizeName(g.name);
        return gn.length >= 5 && gn.includes(normalizedBulkName);
      });
      if (found) return found;
    }

    return null;
  };

  document.getElementById('btnBulkImgApply')?.addEventListener('click', () => {
    const text = document.getElementById('bulkImgInput').value.trim();
    if (!text) return bulkMsg('bulkImgMsg', '⚠️ Cole ao menos uma linha no formato: Nome | URL', 'red');
    const map = parseBulk(text);
    const games = getGames();
    let matched = 0;
    const notFound = [];
    const matchedDetails = [];
    const usedGameIds = new Set();

    Object.entries(map).forEach(([normKey, data]) => {
      const g = findGameByFuzzyName(games.filter(g => !usedGameIds.has(g.id)), normKey);
      if (g) {
        g.img = data.url;
        usedGameIds.add(g.id);
        matched++;
        if (matchedDetails.length < 5) matchedDetails.push(`"${data.original}" → "${g.name}"`);
      } else {
        notFound.push(data.original);
      }
    });

    saveGames(games);

    let msg = `✅ ${matched} imagem(ns) aplicada(s) com sucesso.`;
    if (matchedDetails.length > 0) {
      msg += ` Ex: ${matchedDetails.slice(0,3).join(' · ')}`;
    }
    if (notFound.length > 0) {
      msg += ` ⚠️ ${notFound.length} não encontrado(s): ${notFound.slice(0,5).join(', ')}${notFound.length > 5 ? '...' : ''}`;
    }
    bulkMsg('bulkImgMsg', msg, matched > 0 ? 'green' : 'red');
    renderCardsConfig();
  });

  // ========= 🎁 Aplicar + Criar jogos que não existem no catálogo =========
  document.getElementById('btnBulkImgApplyCreate')?.addEventListener('click', () => {
    const text = document.getElementById('bulkImgInput').value.trim();
    if (!text) return bulkMsg('bulkImgMsg', '⚠️ Cole ao menos uma linha no formato: Nome | URL', 'red');

    const map = parseBulk(text);
    const games = getGames();
    let matched = 0, created = 0;
    const createdNames = [];
    const usedGameIds = new Set();

    // Função que infere o provider a partir do nome e da URL da imagem
    const inferProvider = (name, imgUrl) => {
      const u = (imgUrl || '').toLowerCase();
      const n = (name || '').toLowerCase();

      if (u.includes('pg-soft') || u.includes('pgsoft') || u.includes('/pg/') ||
          u.includes('pocketgames') || n.includes(' pg')) return 'pgsoft';
      if (u.includes('pragmatic') || u.includes('/pp/')) return 'pragmatic';
      if (u.includes('wgs') || u.includes('wg-casino') || u.includes('wgcasino')) return 'wg';

      // Heurística pelo nome — jogos típicos PG Soft
      if (n.includes('fortune ') || n.includes('mahjong') || n.includes('ganesha') ||
          n.includes('lucky neko') || n.includes('wild bandito') || n.includes('caishen')) {
        return 'pgsoft';
      }
      // Heurística Pragmatic
      if (n.includes('gates of olympus') || n.includes('sweet bonanza') ||
          n.includes('sugar rush') || n.includes('big bass') || n.includes('starlight') ||
          n.includes('dog house') || n.includes('wolf gold') || n.includes('wild west')) {
        return 'pragmatic';
      }

      // Default mais seguro: pgsoft (concorrente da imagem era PG Soft)
      return 'pgsoft';
    };

    // Infere emoji a partir do nome do jogo (heurística leve)
    const inferEmoji = (name) => {
      const n = (name || '').toLowerCase();
      const map = [
        [['tiger','tigre'], '🐯'], [['ox','touro','bull'], '🐂'],
        [['rabbit','coelho'], '🐰'], [['mouse','ratinho','rato'], '🐭'],
        [['dragon','dragão'], '🐉'], [['snake','serpente','cobra'], '🐍'],
        [['rooster','galo','chicken'], '🐓'], [['panda'], '🐼'],
        [['neko','cat','gato'], '🐱'], [['monkey','macaco'], '🐵'],
        [['lion','leão'], '🦁'], [['wolf','lobo'], '🐺'],
        [['olympus','zeus','god'], '⚡'], [['sweet','candy','sugar','bonanza'], '🍭'],
        [['egypt','egito','pharaoh','cleo'], '🏺'], [['pirate','pirata'], '🏴‍☠️'],
        [['ocean','sea','mar','fish'], '🌊'], [['fortune','luck'], '🍀'],
        [['ninja','samurai'], '⚔️'], [['western','cowboy','wild west'], '🤠'],
        [['fruit','fruta'], '🍉'], [['flower','flor','bloom'], '🌸'],
        [['star','estrela','princess'], '✨'], [['gold','dourado'], '🪙'],
        [['gem','jewel','diamond'], '💎'], [['robot','cyber'], '🤖'],
        [['fire','fogo','phoenix'], '🔥'], [['ice','snow','neve','frozen'], '❄️'],
        [['bikini','paradise','beach'], '🏝️'], [['football','soccer'], '⚽'],
        [['mahjong'], '🀄'], [['ganesha','india'], '🐘'],
        [['scholar','book','livro'], '📚'], [['mask','mascara'], '🎭'],
        [['warrior','battle'], '🛡️'], [['genie','arabian','aladdin'], '🧞'],
        [['mummy','tomb'], '⚰️'], [['magic','witch'], '🪄'],
      ];
      for (const [kws, emoji] of map) {
        if (kws.some(k => n.includes(k))) return emoji;
      }
      return '🎰';
    };

    // Infere theme a partir do nome
    const inferTheme = (name) => {
      const n = (name || '').toLowerCase();
      if (n.includes('tiger') || n.includes('ox') || n.includes('mahjong') || n.includes('qilin') ||
          n.includes('fortune') || n.includes('neko') || n.includes('panda') || n.includes('dragon') ||
          n.includes('caishen')) return 'chinese';
      if (n.includes('olympus') || n.includes('zeus') || n.includes('perseus') || n.includes('hades')) return 'greek';
      if (n.includes('sweet') || n.includes('candy') || n.includes('sugar') || n.includes('bonanza')) return 'candy';
      if (n.includes('egypt') || n.includes('cleo') || n.includes('ra') || n.includes('pharaoh')) return 'egypt';
      if (n.includes('pirate') || n.includes('kraken')) return 'pirate';
      if (n.includes('fish') || n.includes('bass') || n.includes('ocean')) return 'fishing';
      if (n.includes('ninja') || n.includes('samurai') || n.includes('thai') || n.includes('muay')) return 'asian';
      if (n.includes('buffalo') || n.includes('wolf') || n.includes('west') || n.includes('cowboy')) return 'western';
      if (n.includes('fruit') || n.includes('cherry') || n.includes('watermelon')) return 'fruit';
      if (n.includes('aztec') || n.includes('inca')) return 'aztec';
      if (n.includes('space') || n.includes('galactic') || n.includes('cosmic')) return 'space';
      if (n.includes('flower') || n.includes('bikini') || n.includes('paradise')) return 'flower';
      if (n.includes('gold') || n.includes('jewel') || n.includes('diamond')) return 'luxury';
      return 'fantasy';
    };

    // 1. Primeiro aplica nos que casam
    Object.entries(map).forEach(([normKey, data]) => {
      const g = findGameByFuzzyName(games.filter(g => !usedGameIds.has(g.id)), normKey);
      if (g) {
        g.img = data.url;
        usedGameIds.add(g.id);
        matched++;
      } else {
        // 2. Cria novo jogo no catálogo
        const provider = inferProvider(data.original, data.url);
        const emoji = inferEmoji(data.original);
        const theme = inferTheme(data.original);
        const nextId = Math.max(...games.map(g => g.id), 0) + 1;

        // Distribui 1 dos 6 links de afiliado
        const linkIdx = (nextId - 1) % AFFILIATE_LINKS.length;

        const novo = {
          id: nextId,
          name: data.original,
          provider,
          emoji,
          theme,
          dist: 96,
          rtp: 96.5,
          minBet: 0.20,
          maxBet: 500,
          hot: Math.random() > 0.7 ? 'fire' : null,
          tag: null,
          img: data.url,
          link: AFFILIATE_LINKS[linkIdx],
          clicks: 0
        };
        games.push(novo);
        created++;
        if (createdNames.length < 5) createdNames.push(data.original);
      }
    });

    saveGames(games);

    let msg = `✅ ${matched} jogo(s) atualizado(s) · 🆕 ${created} jogo(s) criado(s)`;
    if (createdNames.length > 0) {
      msg += ` · Novos: ${createdNames.join(', ')}${created > 5 ? '...' : ''}`;
    }
    if (created > 0) {
      msg += ` 💡 Os novos jogos ficam no final do catálogo. Você pode reordenar ou ajustar provider/RTP no "Gerenciar Jogos".`;
    }
    bulkMsg('bulkImgMsg', msg, (matched > 0 || created > 0) ? 'green' : 'red');
    renderCardsConfig();
    if (typeof renderDashboard === 'function') renderDashboard();
  });

  document.getElementById('btnBulkImgExport')?.addEventListener('click', () => {
    const games = getGames();
    const lines = games
      .filter(g => g.img && g.img.trim())
      .map(g => `${g.name} | ${g.img}`)
      .join('\n');
    document.getElementById('bulkImgInput').value = lines || '(Nenhum jogo tem URL customizada ainda)';
    bulkMsg('bulkImgMsg', `📋 ${lines.split('\n').length} URL(s) exportada(s) no campo acima.`, 'green');
  });

  document.getElementById('btnBulkImgClear')?.addEventListener('click', () => {
    if (!confirm('Remover TODAS as URLs de imagem? Os cards voltarão ao visual padrão (SVG).')) return;
    const games = getGames();
    games.forEach(g => g.img = '');
    saveGames(games);
    bulkMsg('bulkImgMsg', `🧹 Todas as URLs foram removidas. ${games.length} jogos voltaram ao visual padrão.`, 'green');
    renderCardsConfig();
  });

  // ========= Links em Massa =========
  document.getElementById('btnBulkLinkApply')?.addEventListener('click', () => {
    const text = document.getElementById('bulkLinkInput').value.trim();
    if (!text) return bulkMsg('bulkLinkMsg', '⚠️ Cole ao menos uma linha no formato: Nome | Link', 'red');
    const map = parseBulk(text);
    const games = getGames();
    let matched = 0;
    const notFound = [];
    const usedGameIds = new Set();

    Object.entries(map).forEach(([normKey, data]) => {
      const g = findGameByFuzzyName(games.filter(g => !usedGameIds.has(g.id)), normKey);
      if (g) {
        g.link = data.url;
        usedGameIds.add(g.id);
        matched++;
      } else {
        notFound.push(data.original);
      }
    });

    saveGames(games);
    let msg = `✅ ${matched} link(s) aplicado(s) com sucesso.`;
    if (notFound.length) msg += ` ⚠️ ${notFound.length} não encontrado(s): ${notFound.slice(0,5).join(', ')}${notFound.length > 5 ? '...' : ''}`;
    bulkMsg('bulkLinkMsg', msg, matched > 0 ? 'green' : 'red');
    renderCardsConfig();
  });

  document.getElementById('btnBulkLinkExport')?.addEventListener('click', () => {
    const games = getGames();
    const lines = games
      .filter(g => g.link && g.link.trim() && !g.link.includes('example.com'))
      .map(g => `${g.name} | ${g.link}`)
      .join('\n');
    document.getElementById('bulkLinkInput').value = lines || '(Nenhum jogo tem link real ainda)';
    bulkMsg('bulkLinkMsg', `📋 ${lines.split('\n').length} link(s) exportado(s) no campo acima.`, 'green');
  });

  // ========= 💣 Zerar catálogo (começar do zero) =========
  const clearCatalogMsg = (txt, color) => {
    const el = document.getElementById('clearCatalogMsg');
    if (!el) return;
    el.textContent = txt;
    el.style.display = 'block';
    el.style.background = color === 'green' ? 'rgba(34,197,94,0.15)' : color === 'red' ? 'rgba(239,68,68,0.15)' : 'rgba(148,163,184,0.15)';
    el.style.color = color === 'green' ? '#4ADE80' : color === 'red' ? '#F87171' : '#CBD5E1';
    el.style.border = `1px solid ${color === 'green' ? '#22c55e' : color === 'red' ? '#ef4444' : '#475569'}`;
  };

  // ========= 🎯 Manter apenas jogos com imagem oficial aplicada =========
  document.getElementById('btnKeepOnlyWithImg')?.addEventListener('click', () => {
    const games = getGames();
    const comImg = games.filter(g => {
      if (!g.img || !g.img.trim()) return false;
      // Considera imagem oficial se não for data URI (SVG gerado) nem URL interna de placeholder
      if (g.img.startsWith('data:')) return false;
      return true;
    });
    const semImg = games.length - comImg.length;

    if (comImg.length === 0) {
      clearCatalogMsg(`⚠️ Nenhum jogo tem imagem oficial ainda. Rode o script do concorrente primeiro e aplique as URLs com "🎁 Aplicar + Criar Faltantes".`, 'red');
      return;
    }

    if (semImg === 0) {
      clearCatalogMsg(`✅ Todos os ${games.length} jogos já têm imagem oficial. Nada a remover.`, 'green');
      return;
    }

    if (!confirm(`Isso vai DELETAR ${semImg} jogo(s) que ainda não receberam imagem oficial.\n\nVão ficar só ${comImg.length} jogos (os que você já aplicou URL do concorrente).\n\nContinuar?`)) return;

    // Reatribui IDs sequenciais para manter a ordem
    comImg.forEach((g, i) => g.id = i + 1);
    saveGames(comImg);

    clearCatalogMsg(`🎯 Catálogo limpo: mantidos ${comImg.length} jogos com imagem oficial · deletados ${semImg} jogos sem imagem.`, 'green');
    renderCardsConfig();
    if (typeof renderDashboard === 'function') renderDashboard();
  });

  document.getElementById('btnClearCatalog')?.addEventListener('click', () => {
    const games = getGames();
    const total = games.length;
    if (!confirm(`Zerar o catálogo vai apagar TODOS os ${total} jogos atuais.\n\nVocê vai começar do ZERO e depois usa "Aplicar + Criar Faltantes" para popular com os jogos do concorrente.\n\nTem certeza?`)) return;
    if (!confirm(`Última confirmação: apagar ${total} jogos. Esta ação é IRREVERSÍVEL (exceto se você exportou backup antes).\n\nContinuar?`)) return;

    saveGames([]); // array vazio
    clearCatalogMsg(`💣 Catálogo zerado! ${total} jogos removidos. Agora cole os dados do concorrente em "URLs de Imagens em Massa" e clique em "🎁 Aplicar + Criar Faltantes".`, 'green');
    renderCardsConfig();
    if (typeof renderDashboard === 'function') renderDashboard();
  });

  document.getElementById('btnClearCatalogBackup')?.addEventListener('click', () => {
    const games = getGames();
    const total = games.length;
    if (total === 0) {
      clearCatalogMsg('O catálogo já está vazio.', 'red');
      return;
    }
    if (!confirm(`Isso vai BAIXAR um backup JSON dos ${total} jogos atuais e depois zerar o catálogo. Continuar?`)) return;

    // Gera e baixa backup
    const backup = {
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      reason: 'backup-before-clear',
      games: games,
      social: getSocial(),
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slotmestre-backup-antes-de-zerar-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);

    // Aguarda um pouco pro download começar
    setTimeout(() => {
      saveGames([]);
      clearCatalogMsg(`💾 Backup baixado + 💣 catálogo zerado (${total} jogos). Para restaurar depois: Configurações → "Importar Backup" (ou cole o JSON manualmente).`, 'green');
      renderCardsConfig();
      if (typeof renderDashboard === 'function') renderDashboard();
    }, 400);
  });

  // ========= 🧪 Testar URLs de imagem =========
  document.getElementById('btnTestImages')?.addEventListener('click', async () => {
    const result = document.getElementById('testImagesResult');
    if (!result) return;
    const games = getGames();
    const withImg = games.filter(g => g.img && g.img.trim() && !g.img.startsWith('data:'));

    if (withImg.length === 0) {
      result.style.display = 'block';
      result.innerHTML = '<div style="color: #F87171;">⚠️ Nenhum jogo tem URL de imagem customizada para testar.</div>';
      return;
    }

    result.style.display = 'block';
    result.innerHTML = `<div style="color: #A78BFA;">🧪 Testando ${withImg.length} imagens... (pode demorar alguns segundos)</div>`;

    const testSingle = (game) => new Promise(resolve => {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      const timeout = setTimeout(() => {
        resolve({ game, status: 'timeout' });
      }, 7000);
      img.onload = () => {
        clearTimeout(timeout);
        resolve({ game, status: img.naturalWidth > 10 ? 'ok' : 'zero-size' });
      };
      img.onerror = () => {
        clearTimeout(timeout);
        resolve({ game, status: 'error' });
      };
      img.src = game.img;
    });

    // Testa em paralelo, em lotes de 10
    const results = [];
    const batchSize = 10;
    for (let i = 0; i < withImg.length; i += batchSize) {
      const batch = withImg.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map(testSingle));
      results.push(...batchResults);
      result.innerHTML = `<div style="color: #A78BFA;">🧪 Testando ${i + batchSize}/${withImg.length}...</div>`;
    }

    const ok = results.filter(r => r.status === 'ok');
    const errors = results.filter(r => r.status !== 'ok');

    let html = `
      <div style="margin-bottom: 12px;">
        <div style="font-weight: 600; color: #4ADE80; margin-bottom: 4px;">✅ ${ok.length} URLs funcionam corretamente</div>
        ${errors.length > 0 ? `<div style="font-weight: 600; color: #F87171;">❌ ${errors.length} URLs com problema</div>` : ''}
      </div>
    `;

    if (errors.length > 0) {
      html += '<details><summary style="cursor: pointer; color: #F87171; font-weight: 600; padding: 6px 0;">Ver jogos com problema</summary><div style="max-height: 300px; overflow-y: auto; margin-top: 8px;">';
      errors.forEach(r => {
        const reason = {
          error: '❌ Erro (provavelmente bloqueio de hotlink ou 404)',
          timeout: '⏱️ Timeout (servidor demorou muito)',
          'zero-size': '📭 Carregou vazio (0x0)'
        }[r.status];
        html += `<div style="padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 0.8rem;">
          <strong>${sanitize(r.game.name)}</strong> — <span style="color:#F87171;">${reason}</span><br>
          <span style="color: #94A3B8; font-family: monospace; font-size: 0.72rem;">${sanitize(r.game.img.slice(0, 90))}${r.game.img.length > 90 ? '...' : ''}</span>
        </div>`;
      });
      html += '</div></details>';
      html += `<div style="margin-top: 12px; padding: 10px; background: rgba(239,68,68,0.1); border-left: 3px solid #ef4444; border-radius: 4px; font-size: 0.82rem;">
        💡 <strong>Possíveis causas:</strong><br>
        1. O concorrente ativou <strong>bloqueio de hotlinking</strong> (bloqueia imagens quando acessadas de outro site).<br>
        2. A URL não existe mais (404).<br>
        3. Servidor do concorrente está fora do ar.<br><br>
        <strong>Solução:</strong> Baixar as imagens funcionais e hospedar no seu próprio servidor. Ou extrair de outro site (Stake, Betano, Pragmatic oficial).
      </div>`;
    } else {
      html += `<div style="margin-top: 10px; padding: 10px; background: rgba(34,197,94,0.1); border-left: 3px solid #22c55e; border-radius: 4px; font-size: 0.85rem;">
        🎉 Todas as ${ok.length} URLs estão funcionando! Se mesmo assim não aparecem no site, tente <strong>Ctrl+Shift+R</strong> para limpar o cache.
      </div>`;
    }

    result.innerHTML = html;
  });

  document.getElementById('btnResetAll')?.addEventListener('click', () => {
    if (!confirm('ATENÇÃO: isso apaga TODOS os dados. Confirmar?')) return;
    if (!confirm('Tem certeza? Esta ação é IRREVERSÍVEL.')) return;
    Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
    clearSession();
    showToast('Sistema resetado. Recarregando...', 'default');
    setTimeout(() => location.reload(), 1200);
  });
}

function getStorageSize() {
  try {
    let size = 0;
    Object.values(STORAGE_KEYS).forEach(k => {
      const v = localStorage.getItem(k);
      if (v) size += v.length;
    });
    return (size / 1024).toFixed(1);
  } catch { return '?'; }
}

/* ============================================
   INIT
   ============================================ */
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('adminApp')) initAdmin();
});
