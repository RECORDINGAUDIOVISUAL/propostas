// =====================================================================
// Gerador de Propostas · Cloudflare Worker + banco D1
// Painel:  /painel     Proposta do cliente:  /CODIGO     API: /api/...
// Ligações necessárias (Settings do Worker): banco D1 com o nome  DB
//                                            variável (secreta)   CHAVE_INSTALACAO
// =====================================================================
const PAINEL_HTML = __PAINEL__;
const INDEX_HTML = __INDEX__;
const SCHEMA = __SCHEMA__;

const VERSAO = 'v8.2';
const TZ = 'America/Sao_Paulo';
const ST = ['Atendimento', 'Briefing', 'Rascunho', 'Enviada', 'Negociação', 'Fechada', 'Perdida'];
const ITER = 30000;            // custo do hash de senha (PBKDF2-SHA256)
const SESSAO_MS = 30 * 86400000;

// ---------- utilidades ----------
const enc = new TextEncoder();
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const rnd = n => hex(crypto.getRandomValues(new Uint8Array(n)));
const sha256 = async s => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
async function pbkdf2(senha, sal, iter) {
  const k = await crypto.subtle.importKey('raw', enc.encode(senha), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(sal), iterations: iter }, k, 256));
}
function iguais(a, b) { a = String(a); b = String(b); if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
// ---------- verificação em duas etapas (TOTP: Google Authenticator, 1Password, Authy) ----------
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32enc(bytes) { let bits = 0, val = 0, out = ''; for (const b of bytes) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } val &= (1 << bits) - 1; } if (bits > 0) out += B32[(val << (5 - bits)) & 31]; return out; }
function b32dec(str) { let bits = 0, val = 0; const out = []; for (const c of String(str).replace(/=+$/, '').toUpperCase()) { const i = B32.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } val &= (1 << bits) - 1; } return new Uint8Array(out); }
async function totpCodigo(segredo, passo) {
  const key = await crypto.subtle.importKey('raw', b32dec(segredo), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']), buf = new ArrayBuffer(8), dv = new DataView(buf);
  dv.setUint32(0, Math.floor(passo / 4294967296)); dv.setUint32(4, passo >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf)), o = h[19] & 15, n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1000000).padStart(6, '0');
}
async function totpOk(segredo, codigo) {
  const c = String(codigo || '').replace(/\D/g, ''); if (c.length !== 6) return false;
  const p = Math.floor(Date.now() / 30000); let ok = false;
  for (const d of [-1, 0, 1]) if (iguais(await totpCodigo(segredo, p + d), c)) ok = true;
  return ok;
}
const num = s => Number(String(s == null || s === '' ? '0' : s).replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.')) || 0;   // texto pt-BR (importação)
const nj = (x, d = 0) => { if (x === '' || x == null) return d; const n = Number(x); return isFinite(n) ? n : d; };                                                           // número vindo da API
const cut = (s, n) => String(s == null ? '' : s).slice(0, n);
const fone = s => { const d = String(s || '').replace(/\D/g, ''); return d && d.length <= 11 ? '55' + d : d; };
const linhas = s => String(s || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => l.split('|').map(x => x.trim()));

// ---------- mensagens automáticas (editáveis no painel, aba Mensagens) ----------
// Variáveis: {nome} {nome_completo} {cliente} {projeto} {numero} {link} {validade} {validade_txt} {empresa} {responsavel} {prazo_proposta}
const MSG_PADRAO = {
  msg_envio: 'Olá, {nome}! Tudo bem?\n\nCom base no briefing que você nos enviou, preparamos a proposta do projeto *{projeto}* para a {cliente}:\n{link}\n\nNela estão o escopo, as etapas, os prazos e o investimento. {validade_txt}\n\nSe quiser ajustar qualquer ponto, é só me responder por aqui. Também posso te explicar tudo numa chamada rápida.\n\n{empresa}',
  msg_followup1: 'Olá, {nome}! Passando para saber se você conseguiu ver a proposta de *{projeto}*. Ficou alguma dúvida sobre escopo, prazos ou investimento?\n{link}\n\nSe preferir, eu ajusto o que for preciso.',
  msg_followup2: 'Oi, {nome}! Reforçando que a proposta de *{projeto}* segue disponível:\n{link}\n\nSe fizer sentido, conversamos 10 minutinhos para alinhar os detalhes ou adequar o formato ao seu orçamento. {validade_txt}',
  msg_followup3: 'Olá, {nome}! Último lembrete sobre a proposta de *{projeto}*:\n{link}\n\nSe o momento não for o ideal, sem problema: me avise e retomamos na data que for melhor para vocês. E se algum ponto do escopo ou do valor não encaixou, me conte que eu busco uma alternativa.',
  msg_duvida: 'Olá! Estou vendo a proposta {numero} ({projeto}) e gostaria de tirar uma dúvida: ',
  msg_briefing: 'Olá, {nome}! Recebemos o briefing do projeto *{projeto}*. Obrigado por nos contar os detalhes!\n\nVamos analisar com carinho e enviar a proposta {prazo_proposta}. Se surgir qualquer informação nova, é só responder por aqui.\n\n{empresa}',
  msg_aprovada: 'Olá, {nome}! A proposta de *{projeto}* foi aprovada. Obrigado pela confiança! 🎬\n\nPróximos passos:\n1. Enviamos o aceite formal e os dados da entrada de 30%.\n2. Alinhamos as datas e agendamos a pré-produção.\n\nQualquer dúvida, estou por aqui.\n{empresa}'
};
const primeiroNome = s => { const n = String(s || '').trim().split(/\s+/)[0] || ''; return n ? n[0].toUpperCase() + n.slice(1).toLowerCase() : ''; };
const preencher = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => v[k] !== undefined ? v[k] : m).replace(/,[ \t]*([!.?])/g, '$1').replace(/[ \t]{2,}/g, ' ');
const semMarcas = t => String(t).replace(/\*([^*\n]+)\*/g, '$1');
const baseUrl = (cfg, origin) => /^https:\/\/[a-z0-9.-]+$/i.test(String(cfg.dominio_publico || '').trim()) ? String(cfg.dominio_publico).trim() : origin;
const PAG_PADRAO = { e: 30, et: 'na aprovação da proposta', rt: '30 dias após a aprovação', f: 'Depósito (TED/Pix)\nCrédito parcelado*\nBTC / ETH', o: '*Juros acrescidos pela operadora no momento do pagamento.' };
function pagPadrao(cfg) { const e = nj(cfg.pag_entrada_padrao, PAG_PADRAO.e); return { e: e >= 0 && e <= 100 ? e : PAG_PADRAO.e, et: cfg.pag_entrada_txt_padrao || PAG_PADRAO.et, rt: cfg.pag_resto_txt_padrao || PAG_PADRAO.rt, f: cfg.pag_formas_padrao || PAG_PADRAO.f, o: cfg.pag_obs_padrao || PAG_PADRAO.o }; }
const msg = (cfg, k, v) => preencher(cfg[k] && String(cfg[k]).trim() ? cfg[k] : MSG_PADRAO[k], v);

const OG_PNG = '__ASSET_OG_PNG__';
const FAV64 = '__ASSET_FAV64__', FAV180 = '__ASSET_FAV180__';
const bytes = b => Uint8Array.from(atob(b), c => c.charCodeAt(0));

function spParts(d) {
  const o = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d || new Date()).forEach(p => o[p.type] = p.value);
  return o;
}
const hojeBR = () => { const o = spParts(); return `${o.day}/${o.month}/${o.year}`; };
const agoraBR = () => { const o = spParts(); return `${o.day}/${o.month}/${o.year} ${o.hour}:${o.minute}`; };
function maisDiasBR(n) { const o = spParts(), t = new Date(Date.UTC(+o.year, +o.month - 1, +o.day + n)); return `${String(t.getUTCDate()).padStart(2, '0')}/${String(t.getUTCMonth() + 1).padStart(2, '0')}/${t.getUTCFullYear()}`; }
function dataNum(s) { const m = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s || ''); return m ? (+m[3]) * 10000 + (+m[2]) * 100 + (+m[1]) : 0; }
const escH = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const brl = n => 'R$ ' + (Number(n) || 0).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const SEC = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow', 'Cache-Control': 'no-store', 'Strict-Transport-Security': 'max-age=31536000' };
const CSP = "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'";
const json = (o, s = 200, h = {}) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json; charset=utf-8', ...SEC, ...h } });
const page = (b, s = 200, h = {}) => new Response(b, { status: s, headers: { 'Content-Type': 'text/html; charset=utf-8', ...SEC, ...h } });
const erro = (msg, s = 400) => json({ ok: false, erro: msg }, s);

class Falha extends Error { constructor(msg, status) { super(msg); this.status = status || 400; } }

async function lerJson(req) { try { return await req.json(); } catch (e) { throw new Falha('Pedido inválido.'); } }

// ---------- banco ----------
let pronto = false;
async function garantirSchema(db) {
  if (pronto) return;
  const ok = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='propostas'").first();
  if (!ok) await db.batch(SCHEMA.map(s => db.prepare(s)));
  const cols = (await db.prepare('PRAGMA table_info(propostas)').all()).results.map(c => c.name);
  for (const [n, t] of [['visto_n', 'INTEGER NOT NULL DEFAULT 0'], ['visto_primeiro', "TEXT NOT NULL DEFAULT ''"], ['visto_ultimo', "TEXT NOT NULL DEFAULT ''"], ['resposta_meta', "TEXT NOT NULL DEFAULT ''"]])
    if (!cols.includes(n)) await db.prepare(`ALTER TABLE propostas ADD COLUMN ${n} ${t}`).run();
  for (const [n, t] of [['cliente_id', 'INTEGER'], ['pag_entrada', 'REAL NOT NULL DEFAULT -1'], ['pag_entrada_txt', "TEXT NOT NULL DEFAULT ''"], ['pag_resto_txt', "TEXT NOT NULL DEFAULT ''"], ['pag_formas', "TEXT NOT NULL DEFAULT ''"], ['pag_obs', "TEXT NOT NULL DEFAULT ''"]])
    if (!cols.includes(n)) await db.prepare(`ALTER TABLE propostas ADD COLUMN ${n} ${t}`).run();
  const ucols = (await db.prepare('PRAGMA table_info(usuarios)').all()).results.map(c => c.name);
  for (const n of ['totp', 'totp_pend']) if (!ucols.includes(n)) await db.prepare(`ALTER TABLE usuarios ADD COLUMN ${n} TEXT NOT NULL DEFAULT ''`).run();
  await db.prepare("CREATE TABLE IF NOT EXISTS clientes (id INTEGER PRIMARY KEY AUTOINCREMENT, empresa TEXT NOT NULL, cnpj TEXT NOT NULL DEFAULT '', contato_nome TEXT NOT NULL DEFAULT '', contato_email TEXT NOT NULL DEFAULT '', contato_whatsapp TEXT NOT NULL DEFAULT '', site TEXT NOT NULL DEFAULT '', cidade TEXT NOT NULL DEFAULT '', obs TEXT NOT NULL DEFAULT '', hubspot_id TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL DEFAULT (datetime('now')))").run();
  await db.prepare('UPDATE propostas SET imposto_pct=6 WHERE imposto_pct<0 OR imposto_pct>100').run();
  pronto = true;
}
async function cfgAll(db) { const r = await db.prepare('SELECT chave,valor FROM config').all(), o = {}; r.results.forEach(x => o[x.chave] = x.valor); return o; }
async function cfgSet(db, o) {
  const st = Object.keys(o).map(k => db.prepare('INSERT INTO config(chave,valor) VALUES(?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor').bind(k, cut(o[k], 5000)));
  if (st.length) await db.batch(st);
}
async function chaveOk(env, k) {
  const c = (await env.DB.prepare("SELECT valor FROM config WHERE chave='n8n_key'").first('valor')) || '';
  return !!c && iguais(k || '', c);
}

// ---------- usuários e sessão ----------
async function salvarUsuario(db, login, senha) {
  login = String(login || '').trim().toLowerCase(); senha = String(senha || '');
  if (!/^[a-z0-9._@-]{3,60}$/.test(login)) throw new Falha('Login: use de 3 a 60 letras minúsculas, números, ponto, hífen ou @.');
  if (senha.length < 10) throw new Falha('A senha precisa ter pelo menos 10 caracteres. Uma frase longa é melhor e mais fácil de lembrar.');
  const sal = rnd(16), h = ITER + ':' + await pbkdf2(senha, sal, ITER);
  await db.prepare('INSERT INTO usuarios(login,sal,hash) VALUES(?,?,?) ON CONFLICT(login) DO UPDATE SET sal=excluded.sal,hash=excluded.hash').bind(login, sal, h).run();
  await db.prepare('DELETE FROM sessoes WHERE login=?').bind(login).run();
  return login;
}
async function abrirSessao(db, login, https) {
  const t = rnd(32);
  await db.prepare('DELETE FROM sessoes WHERE expira<?').bind(Date.now()).run();
  await db.prepare('INSERT INTO sessoes(hash,login,expira) VALUES(?,?,?)').bind(await sha256(t), login, Date.now() + SESSAO_MS).run();
  return `sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSAO_MS / 1000}${https ? '; Secure' : ''}`;
}
const cookie = (req, n) => { const m = (req.headers.get('Cookie') || '').split(/;\s*/).find(c => c.startsWith(n + '=')); return m ? m.slice(n.length + 1) : ''; };
async function quemE(req, env) {
  const t = cookie(req, 'sid');
  if (!/^[0-9a-f]{64}$/.test(t)) return null;
  const r = await env.DB.prepare('SELECT login,expira FROM sessoes WHERE hash=?').bind(await sha256(t)).first();
  return r && r.expira > Date.now() ? r.login : null;
}

// ---------- propostas ----------
const EDIT = ['status', 'cliente', 'projeto', 'responsavel', 'data', 'validade', 'objetivo', 'entregas', 'etapas', 'prazos', 'imposto_pct', 'desconto_pct', 'faixa', 'briefing', 'pendencias', 'data_envio', 'followup', 'contato_nome', 'contato_whatsapp', 'contato_email', 'briefing_texto', 'cliente_id', 'pag_entrada', 'pag_entrada_txt', 'pag_resto_txt', 'pag_formas', 'pag_obs'];
const LIM = { pag_formas: 1500, pag_obs: 500, objetivo: 5000, entregas: 8000, prazos: 8000, etapas: 1000, briefing_texto: 30000, pendencias: 3000 };
function valorCampo(k, v) {
  if (k === 'cliente_id') { const n = Math.round(nj(v, 0)); return n > 0 ? n : null; }
  if (k === 'pag_entrada') { if (v === '' || v == null) return -1; return Math.min(100, Math.max(0, nj(v, -1))); }
  if (k === 'imposto_pct' || k === 'desconto_pct') return Math.min(100, Math.max(0, nj(v)));
  if (k === 'faixa') return nj(v) === 2 ? 2 : 1;
  if (k === 'status') { if (ST.indexOf(v) < 0) throw new Falha('Status inválido.'); return v; }
  if (k === 'briefing') return v === 'Sim' ? 'Sim' : 'Não';
  if (k === 'contato_whatsapp') return fone(v);
  return cut(v, LIM[k] || 300).trim();
}
const totais = (p, its) => { const sub = its.reduce((a, i) => a + i.qtd * i.valor_unit, 0), d = sub * nj(p.desconto_pct) / 100, imp = (sub - d) * nj(p.imposto_pct) / 100; return { sub, desc: d, imp, total: sub - d + imp }; };

async function novoNumero(db, cfg) {
  const o = spParts(), pref = /^[A-Za-z0-9]{1,6}$/.test(String(cfg.prefixo || '').trim()) ? String(cfg.prefixo).trim().toUpperCase() : 'REC', p = `${pref}-${o.year.slice(2)}${o.month}-`;
  const r = await db.prepare('SELECT numero FROM propostas WHERE numero LIKE ?').bind(p + '%').all();
  let max = 0; r.results.forEach(x => { max = Math.max(max, Number(x.numero.slice(p.length)) || 0); });
  return p + String(max + 1).padStart(3, '0');
}
async function criarProposta(db, ini) {
  const cfg = await cfgAll(db);
  const ip = nj(cfg.imposto_padrao, 6), base = Object.assign({ status: 'Rascunho', data: hojeBR(), validade: cfg.validade_padrao || '15 dias', imposto_pct: ip >= 0 && ip <= 100 ? ip : 6, faixa: 1, desconto_pct: 0, briefing: 'Não', pag_entrada: pagPadrao(cfg).e, pag_entrada_txt: pagPadrao(cfg).et, pag_resto_txt: pagPadrao(cfg).rt, pag_formas: pagPadrao(cfg).f, pag_obs: pagPadrao(cfg).o }, ini || {});
  for (let tent = 0; tent < 5; tent++) {
    const numero = await novoNumero(db, cfg), cols = ['numero', 'token'], vals = [numero, rnd(8)];
    Object.keys(base).forEach(k => { cols.push(k); vals.push(base[k]); });
    try {
      await db.prepare(`INSERT INTO propostas(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`).bind(...vals).run();
      return numero;
    } catch (e) { if (/origem_id/.test(String(e.message)) || tent === 4) throw e; }
  }
}
async function listarTudo(db, origin) {
  const P = (await db.prepare('SELECT * FROM propostas ORDER BY criado_em, numero').all()).results;
  const I = (await db.prepare('SELECT * FROM itens ORDER BY numero, ordem, id').all()).results, g = {};
  I.forEach(i => (g[i.numero] = g[i.numero] || []).push({ servico: i.servico, descricao: i.descricao, observacao: i.observacao, qtd: i.qtd, valor_unit: i.valor_unit, valor: i.qtd * i.valor_unit }));
  P.forEach(p => { p.itens = g[p.numero] || []; p.t = totais(p, p.itens); delete p.origem_id; });
  const catalogo = (await db.prepare('SELECT servico,descricao,condicao,faixa1,faixa2,categoria FROM catalogo ORDER BY ordem,id').all()).results;
  return { propostas: P, catalogo, base: origin };
}
async function salvarProposta(db, o) {
  const numero = String(o && o.numero || '');
  if (!await db.prepare('SELECT 1 x FROM propostas WHERE numero=?').bind(numero).first()) throw new Falha('Proposta não encontrada.', 404);
  const sets = [], vals = [];
  EDIT.forEach(k => { if (o[k] !== undefined) { sets.push(k + '=?'); vals.push(valorCampo(k, o[k])); } });
  const its = (Array.isArray(o.itens) ? o.itens : []).slice(0, 200).filter(i => i && String(i.servico || '').trim());
  const st = [];
  if (sets.length) st.push(db.prepare(`UPDATE propostas SET ${sets.join(',')} WHERE numero=?`).bind(...vals, numero));
  st.push(db.prepare('DELETE FROM itens WHERE numero=?').bind(numero));
  its.forEach((i, k) => st.push(db.prepare('INSERT INTO itens(numero,ordem,servico,descricao,observacao,qtd,valor_unit) VALUES(?,?,?,?,?,?,?)')
    .bind(numero, k, cut(i.servico, 200), cut(i.descricao, 1000), cut(i.observacao, 1000), nj(i.qtd, 1), nj(i.valor_unit))));
  await db.batch(st);
}
async function excluirProposta(db, numero) {
  await db.batch([db.prepare('DELETE FROM itens WHERE numero=?').bind(numero), db.prepare('DELETE FROM propostas WHERE numero=?').bind(numero)]);
}

async function duplicarProposta(db, numero) {
  const p = await db.prepare('SELECT * FROM propostas WHERE numero=?').bind(numero).first();
  if (!p) throw new Falha('Proposta não encontrada.', 404);
  const ini = { status: 'Rascunho' };
  ['cliente', 'projeto', 'responsavel', 'validade', 'objetivo', 'entregas', 'etapas', 'prazos', 'imposto_pct', 'desconto_pct', 'faixa', 'contato_nome', 'contato_whatsapp', 'contato_email', 'cliente_id', 'pag_entrada', 'pag_entrada_txt', 'pag_resto_txt', 'pag_formas', 'pag_obs'].forEach(k => ini[k] = p[k]);
  const novo = await criarProposta(db, ini);
  const its = (await db.prepare('SELECT servico,descricao,observacao,qtd,valor_unit FROM itens WHERE numero=? ORDER BY ordem,id').bind(numero).all()).results;
  if (its.length) await db.batch(its.map((i, k) => db.prepare('INSERT INTO itens(numero,ordem,servico,descricao,observacao,qtd,valor_unit) VALUES(?,?,?,?,?,?,?)').bind(novo, k, i.servico, i.descricao, i.observacao, i.qtd, i.valor_unit)));
  return novo;
}

// ---------- cadastro de clientes ----------
const CLI = ['empresa', 'cnpj', 'contato_nome', 'contato_email', 'contato_whatsapp', 'site', 'cidade', 'obs', 'hubspot_id'];
const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
async function listarClientes(db) { return (await db.prepare('SELECT c.*, (SELECT COUNT(*) FROM propostas p WHERE p.cliente_id=c.id) AS n_propostas FROM clientes c ORDER BY c.empresa COLLATE NOCASE').all()).results; }
async function salvarCliente(db, o) {
  const v = {}; CLI.forEach(k => v[k] = cut(o[k], k === 'obs' ? 2000 : 300).trim());
  if (!v.empresa) throw new Falha('Informe o nome da empresa.');
  v.contato_whatsapp = fone(v.contato_whatsapp);
  const id = Math.round(nj(o.id, 0));
  if (id > 0) { await db.prepare(`UPDATE clientes SET ${CLI.map(k => k + '=?').join(',')} WHERE id=?`).bind(...CLI.map(k => v[k]), id).run(); return id; }
  const r = await db.prepare(`INSERT INTO clientes(${CLI.join(',')}) VALUES(${CLI.map(() => '?').join(',')})`).bind(...CLI.map(k => v[k])).run();
  return r.meta.last_row_id;
}
async function acharCliente(db, { empresa, email, hubspot_id }) {
  const todos = (await db.prepare('SELECT id,empresa,contato_email,hubspot_id FROM clientes').all()).results;
  return todos.find(c => hubspot_id && c.hubspot_id === hubspot_id) || todos.find(c => email && norm(c.contato_email) === norm(email)) || todos.find(c => empresa && norm(c.empresa) === norm(empresa)) || null;
}
// importa clientes de um CSV (HubSpot em português ou inglês, ou qualquer planilha com colunas parecidas)
async function importarClientes(db, rows) {
  const ALIAS = { empresa: ['empresa', 'nome da empresa', 'company name', 'company', 'nome fantasia', 'razao social', 'organizacao', 'cliente', 'nome do cliente'], cnpj: ['cnpj', 'cpf/cnpj', 'documento'], email: ['email', 'e-mail', 'contato_email', 'contact email'],
    fone: ['whatsapp', 'telefone', 'phone', 'phone number', 'numero de telefone', 'celular', 'mobile phone number', 'numero de celular', 'contato_whatsapp'], site: ['site', 'website', 'company domain name', 'nome do dominio da empresa', 'url do site', 'domain'],
    cidade: ['cidade', 'city'], hub: ['record id', 'id do registro', 'hubspot_id', 'hubspot id'], obs: ['obs', 'observacoes', 'notes', 'notas'], nome: ['contato', 'contato_nome', 'nome do contato', 'contact name', 'nome completo', 'full name'], primeiro: ['first name', 'nome', 'primeiro nome'], ultimo: ['last name', 'sobrenome', 'ultimo nome'] };
  const reg = (await db.prepare('SELECT id,empresa,contato_email,hubspot_id,cnpj,contato_nome,contato_whatsapp,site,cidade,obs FROM clientes').all()).results.map(c => ({ ...c, _db: true, _mod: false }));
  let criados = 0, atualizados = 0, mesclados = 0, ignorados = 0; const tocados = new Set();
  for (const raw of rows) {
    const m = {}; Object.keys(raw).forEach(k => m[norm(k)] = String(raw[k] == null ? '' : raw[k]).trim());
    const get = al => { for (const a of al) { const k = Object.keys(m).find(x => x === a || x.startsWith(a + ' -')); if (k && m[k]) return m[k]; } return ''; };
    const nome = get(ALIAS.nome) || [get(ALIAS.primeiro), get(ALIAS.ultimo)].filter(Boolean).join(' ');
    const dado = { empresa: get(ALIAS.empresa) || (!get(ALIAS.primeiro) ? m['name'] || '' : '') || nome, cnpj: get(ALIAS.cnpj), contato_nome: nome, contato_email: get(ALIAS.email), contato_whatsapp: fone(get(ALIAS.fone)), site: get(ALIAS.site), cidade: get(ALIAS.cidade), obs: get(ALIAS.obs), hubspot_id: get(ALIAS.hub) };
    if (!dado.empresa) { ignorados++; continue; }
    const ex = reg.find(c => dado.hubspot_id && c.hubspot_id === dado.hubspot_id) || reg.find(c => dado.contato_email && norm(c.contato_email) === norm(dado.contato_email)) || reg.find(c => norm(c.empresa) === norm(dado.empresa));
    if (!ex) { reg.push({ ...dado, _db: false, _mod: true }); criados++; continue; }
    let mudou = false; CLI.forEach(k => { if (k !== 'empresa' && !ex[k] && dado[k]) { ex[k] = dado[k]; mudou = true; } });
    if (!mudou) ignorados++;
    else if (!ex._db) { ex._mod = true; mesclados++; }                // linha do mesmo arquivo: completa o cadastro novo
    else { ex._mod = true; if (!tocados.has(ex.id)) { tocados.add(ex.id); atualizados++; } }
  }
  const st = reg.filter(c => c._mod).map(c => c._db
    ? db.prepare(`UPDATE clientes SET ${CLI.map(k => k + '=?').join(',')} WHERE id=?`).bind(...CLI.map(k => cut(c[k], k === 'obs' ? 2000 : 300)), c.id)
    : db.prepare(`INSERT INTO clientes(${CLI.join(',')}) VALUES(${CLI.map(() => '?').join(',')})`).bind(...CLI.map(k => cut(c[k], k === 'obs' ? 2000 : 300))));
  if (st.length) await db.batch(st);
  return { qtd: criados + atualizados, criados, atualizados, mesclados, ignorados };
}

// ---------- cliente abriu a proposta ----------
const ROBO = /bot|crawl|spider|preview|facebookexternalhit|whatsapp|slurp|headless|lighthouse|curl|wget|python-requests|okhttp|monitor|uptime/i;
async function registrarVisita(req, env, db, t) {
  if (ROBO.test(req.headers.get('User-Agent') || '')) return;           // pré-visualização de link e robôs não contam
  if (await quemE(req, env)) return;                                    // a equipe logada não conta
  const p = await db.prepare('SELECT numero,cliente,projeto,status,visto_n,visto_ultimo FROM propostas WHERE token=?').bind(t).first();
  if (!p || ST.indexOf(p.status) < 3) return;                           // só propostas já enviadas
  const ult = p.visto_ultimo ? Date.parse(p.visto_ultimo) : 0;
  if (ult && Date.now() - ult < 10 * 60000) return;                     // recarregar a página não conta
  const iso = new Date().toISOString();
  await db.prepare("UPDATE propostas SET visto_n=visto_n+1, visto_ultimo=?, visto_primeiro=CASE WHEN visto_primeiro='' THEN ? ELSE visto_primeiro END WHERE token=?").bind(iso, iso, t).run();
  if (!p.visto_n && (await cfgAll(db)).aviso_visualizacao !== '0')
    await novoAviso(db, 'Proposta aberta · ' + p.numero, `👀 ${p.cliente || 'O cliente'} abriu a proposta ${p.numero}${p.projeto ? ' (' + p.projeto + ')' : ''}.\nBom momento para um contato rápido.`);
}

// ---------- página pública da proposta ----------
async function dadosPublicos(db, t, rev, origin) {
  const p = await db.prepare('SELECT * FROM propostas WHERE token=?').bind(t).first();
  if (!p) return { ok: false, msg: 'Proposta não encontrada.' };
  const cfg = await cfgAll(db), brand = {};
  if (p.status === 'Perdida' && !rev) return { ok: false, msg: `Recebemos a sua resposta e esta proposta foi encerrada. Se mudar de ideia, é só falar com a ${cfg.empresa_nome || 'RECording'}${cfg.empresa_email ? ': ' + cfg.empresa_email : ''}.` };
  if (ST.indexOf(p.status) < 3 && !rev) return { ok: false, msg: 'Esta proposta está em revisão. Em breve você receberá o link.' };
  const itens = (await db.prepare('SELECT * FROM itens WHERE numero=? ORDER BY ordem,id').bind(p.numero).all()).results.map(i => [i.servico, i.descricao, i.observacao, i.qtd * i.valor_unit, i.qtd, i.valor_unit]);
  const cond = (await db.prepare('SELECT titulo,texto FROM condicoes ORDER BY ordem,id').all()).results.map(x => [x.titulo, x.texto]);
  [['nome', 'empresa_nome'], ['cnpj', 'empresa_cnpj'], ['email', 'empresa_email'], ['site', 'empresa_site'], ['fone', 'empresa_fone'], ['wa', 'empresa_wa']].forEach(([a, b]) => { if (cfg[b]) brand[a] = cfg[b]; });
  const d = {
    numero: '#' + p.numero, cliente: p.cliente, projeto: p.projeto, responsavel: p.responsavel, data: p.data, validade: p.validade, objetivo: p.objetivo,
    entregas: linhas(p.entregas), etapas: String(p.etapas).split(',').map(s => s.trim()).filter(Boolean), itens, impostoPct: p.imposto_pct, descontoPct: p.desconto_pct,
    prazos: linhas(p.prazos), status: p.status, respostaData: p.resposta_data, brand
  };
  if (cond.length) d.condicoes = cond;
  if (p.pag_entrada >= 0) d.pag2 = { entrada: p.pag_entrada, entradaTxt: p.pag_entrada_txt, restoTxt: p.pag_resto_txt, formas: String(p.pag_formas || '').split('\n').map(x => x.trim()).filter(Boolean), obs: p.pag_obs };
  if (cfg.banco) d.banco = escH(cfg.banco).replace(/\n/g, '<br>');
  if (cfg.texto_agradecimento) d.agradecimento = cfg.texto_agradecimento;
  d.msgDuvida = msg(cfg, 'msg_duvida', varsProposta(p, cfg, origin));
  // Os textos do briefing vêm de um formulário público: escapa tudo no servidor (a página monta o HTML por concatenação).
  const esc = v => typeof v === 'string' ? escH(v) : Array.isArray(v) ? v.map(esc) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, esc(x)])) : v;
  const seguro = esc(d); seguro.banco = d.banco; seguro.msgDuvida = d.msgDuvida;      // banco já tem <br> próprio; msgDuvida é texto puro para a URL do WhatsApp
  return { ok: true, dados: seguro };
}

function varsProposta(p, cfg, origin, extra) {
  return Object.assign({ nome: primeiroNome(p.contato_nome), nome_completo: p.contato_nome || '', cliente: p.cliente || 'sua empresa', projeto: p.projeto || 'seu projeto', numero: p.numero, link: baseUrl(cfg, origin) + '/' + p.token,
    validade: p.validade || '', validade_txt: validadeTxt(p.validade), empresa: cfg.empresa_nome || 'RECording', responsavel: p.responsavel || '', prazo_proposta: cfg.prazo_proposta || 'em até 1 dia útil' }, extra || {});
}
async function avisoCliente(db, assunto, texto, whatsapp, email) {
  if (!whatsapp && !email) return;
  await db.prepare('INSERT INTO avisos(assunto,texto,whatsapp,email) VALUES(?,?,?,?)').bind(cut(assunto, 200), cut(texto, 3000), fone(whatsapp), cut(email, 300)).run();
}
async function responder(db, t, b, origin, meta) {
  const aprova = b.acao === 'aprovar', nome = cut(b.nome, 120).trim(), obs = cut(b.obs, 1000).trim();
  if (aprova && nome.length < 3) return { ok: false, msg: 'Digite seu nome completo para registrar a aprovação.' };
  const quando = agoraBR();
  const r = await db.prepare("UPDATE propostas SET status=?,resposta_data=?,resposta_nome=?,resposta_obs=?,resposta_meta=? WHERE token=? AND status IN ('Enviada','Negociação')")
    .bind(aprova ? 'Fechada' : 'Perdida', quando, nome, obs, cut(meta, 300), t).run();
  const p = await db.prepare('SELECT * FROM propostas WHERE token=?').bind(t).first();
  if (!p) return { ok: false, msg: 'Proposta não encontrada.' };
  if (!r.meta.changes) {
    if (p.status === 'Fechada') return { ok: true, ja: true, msg: 'Esta proposta já foi aprovada.' };
    if (p.status === 'Perdida') return { ok: false, msg: 'Esta proposta já foi encerrada.' };
    return { ok: false, msg: 'Esta proposta ainda não está disponível para aprovação.' };
  }
  const its = (await db.prepare('SELECT qtd,valor_unit FROM itens WHERE numero=?').bind(p.numero).all()).results;
  const tit = (aprova ? 'PROPOSTA APROVADA' : 'Proposta declinada') + ' · ' + p.numero;
  const texto = [(aprova ? '✅ ' : '❌ ') + tit, 'Cliente: ' + (p.cliente || '-'), 'Projeto: ' + (p.projeto || '-'), 'Valor: ' + brl(totais(p, its).total),
    nome ? (aprova ? 'Aprovado por: ' : 'Respondido por: ') + nome : '', obs ? 'Observação: ' + obs : '',
    'Contato: ' + ([p.contato_nome, p.contato_whatsapp, p.contato_email].filter(Boolean).join(' · ') || '-'),
    aprova ? 'Próximo passo: combinar o aceite formal e a entrada de 30%.' : ''].filter(Boolean).join('\n');
  await novoAviso(db, tit + ' · ' + (p.cliente || ''), texto);
  if (aprova) { const cfg = await cfgAll(db); if (cfg.auto_aprovada === '1') await avisoCliente(db, 'Proposta aprovada: próximos passos', msg(cfg, 'msg_aprovada', varsProposta(p, cfg, origin)), p.contato_whatsapp, p.contato_email); }
  return { ok: true };
}
async function novoAviso(db, assunto, texto) {
  const cfg = await cfgAll(db);
  if (!fone(cfg.aviso_whatsapp) && !String(cfg.aviso_email || '').trim()) return;     // sem destino configurado
  await db.prepare('INSERT INTO avisos(assunto,texto,whatsapp,email) VALUES(?,?,?,?)').bind(cut(assunto, 200), cut(texto, 3000), fone(cfg.aviso_whatsapp), cut(cfg.aviso_email, 300)).run();
}

// ---------- entrada do briefing (Tally) ----------
function organizarTally(corpo) {
  let campos = [];
  if (corpo.data && Array.isArray(corpo.data.fields)) {
    campos = corpo.data.fields.map(c => {
      let v = c.value;
      if (Array.isArray(v)) { const op = c.options || []; v = v.map(x => { const o = op.find(k => k.id === x); return o ? o.text : (typeof x === 'object' && x ? (x.name || x.url || '') : x); }).join(', '); }
      return { label: c.label || '', type: c.type || '', value: v };
    });
  } else {
    campos = Object.keys(corpo).filter(k => /^question_/.test(k) && corpo[k] && typeof corpo[k] === 'object' && 'label' in corpo[k])
      .filter(k => !/^question_\w+_[0-9a-f]{8}-[0-9a-f]{4}-/i.test(k)).map(k => ({ label: corpo[k].label || '', type: corpo[k].type || '', value: corpo[k].value }));
  }
  return organizarCampos(campos);
}
function organizarCampos(campos) {
  const texto = c => { let v = c.value; if (v === null || v === undefined || v === false) return ''; if (v === true) return 'Sim'; v = String(v).trim(); if (c.type === 'INPUT_DATE' && /^\d{4}-\d{2}-\d{2}$/.test(v)) v = v.split('-').reverse().join('/'); return v; };
  campos = campos.filter(c => !/achou deste briefing|^feedback$/i.test(c.label));
  const acha = (re, nao) => { const c = campos.find(x => re.test(x.label) && !(nao && nao.test(x.label)) && texto(x)); return c ? texto(c) : ''; };
  const nome = acha(/nome/i), empresa = acha(/organiza[cç][aã]o|empresa|raz[aã]o social|marca/i, /site|perfil|endere|hist[oó]rico/i);
  return {
    cliente: empresa || nome, projeto: acha(/quais produtos|servi[cç]os? ser|projeto|produto/i, /deseja incluir|diferenciais|hist[oó]rico/i).replace(/\s*\n\s*/g, ' · ').replace(/[.\s]+$/, '').slice(0, 120),
    objetivo: acha(/objetivo/i).slice(0, 600), contato_nome: nome, contato_whatsapp: acha(/whats|telefone|celular/i), contato_email: acha(/e-?mail/i),
    briefing_texto: campos.filter(c => texto(c)).map(c => c.label + ': ' + texto(c)).join('\n')
  };
}
function organizarCsv(row) {
  const META = /^(submission id|respondent id|submitted at|created at|id)$/i, keys = Object.keys(row), set = new Set(keys), opts = {}, campos = [];
  keys.forEach(k => {
    if (META.test(k.trim())) return;
    const m = /^(.*\S)\s+\((.+)\)$/.exec(k.trim()), v = String(row[k] == null ? '' : row[k]).trim();
    if (m && set.has(m[1]) && /^(true|false|sim|nao|não|1|0|)$/i.test(v)) { if (/^(true|sim|1)$/i.test(v)) (opts[m[1]] = opts[m[1]] || []).push(m[2]); return; }
    campos.push({ label: k.trim(), type: '', value: v });
  });
  campos.forEach(c => { if (!String(c.value).trim() && opts[c.label]) c.value = opts[c.label].join(', '); });
  return organizarCampos(campos);
}
const idCsv = row => { const k = Object.keys(row).find(x => /^submission id$/i.test(x.trim())); return k && row[k] ? String(row[k]).trim() : null; };
async function receberBriefing(db, d, origemId, silencioso, origin) {
  if (origemId) { const ex = await db.prepare('SELECT numero FROM propostas WHERE origem_id=?').bind(origemId).first('numero'); if (ex) return { ok: true, numero: ex, repetido: true }; }
  const ini = { status: 'Briefing', briefing: 'Sim' };
  ['cliente', 'projeto', 'objetivo', 'contato_nome', 'contato_email', 'briefing_texto'].forEach(k => { if (d[k]) ini[k] = cut(d[k], k === 'briefing_texto' ? 30000 : 600); });
  if (d.contato_whatsapp) ini.contato_whatsapp = fone(d.contato_whatsapp);
  if (origemId) ini.origem_id = cut(origemId, 100);
  if (ini.cliente) { try {
    const c = await acharCliente(db, { empresa: ini.cliente, email: ini.contato_email });
    ini.cliente_id = c ? c.id : await salvarCliente(db, { empresa: ini.cliente, contato_nome: ini.contato_nome, contato_email: ini.contato_email, contato_whatsapp: ini.contato_whatsapp });
  } catch (e) {} }
  const numero = await criarProposta(db, ini);
  if (!silencioso) {
    try { await novoAviso(db, 'Novo briefing · ' + numero, `📝 Novo briefing recebido\nCliente: ${ini.cliente || '-'}\nProjeto: ${ini.projeto || '-'}\nProposta criada: ${numero} (status Briefing)\nAbra o painel para montar os preços.`); } catch (e) {}
    try {
      const cfg = await cfgAll(db);
      if (cfg.auto_briefing === '1') { const p = await db.prepare('SELECT * FROM propostas WHERE numero=?').bind(numero).first(); await avisoCliente(db, 'Recebemos o seu briefing', msg(cfg, 'msg_briefing', varsProposta(p, cfg, origin || '')), p.contato_whatsapp, p.contato_email); }
    } catch (e) {}
  }
  return { ok: true, numero };
}

// ---------- saídas para o n8n (WhatsApp e e-mail) ----------
const validadeTxt = v => { v = String(v || '').trim(); if (!v) return ''; return /^\d+\s*(dias?)?$/i.test(v) ? 'A proposta segue válida por ' + v.replace(/^(\d+)\s*$/, '$1 dias') + '.' : 'Validade: ' + v + '.'; };
async function saidas(db, origin) {
  const itens = [], cfg = await cfgAll(db);
  origin = baseUrl(cfg, origin);
  (await db.prepare('SELECT * FROM avisos WHERE enviado<=0 AND enviado>-3 ORDER BY id LIMIT 20').all()).results
    .forEach(a => itens.push({ tipo: 'aviso', ref: String(a.id), whatsapp: a.whatsapp, email: a.email, assunto: a.assunto, texto: a.texto }));
  const o = spParts();
  if (+o.hour * 60 + +o.minute >= 9 * 60 + 30) {                    // lembretes só depois das 9:30 (Brasília)
    const hoje = dataNum(`${o.day}/${o.month}/${o.year}`);
    const ASS = ['Sobre a proposta de {projeto}', 'Proposta {numero}: posso ajudar em algo?', 'Última lembrança da proposta {numero}'];
    (await db.prepare("SELECT * FROM propostas WHERE status IN ('Enviada','Negociação') AND followup_n<3 AND (contato_whatsapp<>'' OR contato_email<>'')").all()).results
      .filter(p => { const f = dataNum(p.followup); return f && f <= hoje; })
      .forEach(p => {
        const n = p.followup_n + 1, v = varsProposta(p, cfg, origin);
        itens.push({ tipo: 'followup', ref: p.numero, whatsapp: fone(p.contato_whatsapp), email: p.contato_email, assunto: preencher(ASS[n - 1], v), texto: msg(cfg, 'msg_followup' + n, v), tentativa: n });
      });
  }
  itens.forEach(i => { i.texto_email = semMarcas(i.texto); });
  return itens;
}
// wa/em = '1' (canal funcionou) ou '0' (falhou), informados pelo n8n. Sem informação, considera enviado.
async function saidaOk(db, tipo, ref, wa, em) {
  const falhou = wa === '0' && em === '0';
  if (tipo === 'aviso') {
    if (falhou) { await db.prepare('UPDATE avisos SET enviado=enviado-1 WHERE id=? AND enviado<=0').bind(nj(ref)).run(); return { ok: true, falhou: true }; }
    await db.prepare('UPDATE avisos SET enviado=1 WHERE id=?').bind(nj(ref)).run(); return { ok: true };
  }
  if (tipo === 'followup') {
    if (falhou) return { ok: true, falhou: true };                  // não marca: tenta de novo na próxima rodada
    const r = await db.prepare('UPDATE propostas SET followup_n=followup_n+1, followup=? WHERE numero=?').bind(maisDiasBR(3), ref).run(); return { ok: r.meta.changes > 0 };
  }
  return { ok: false };
}

// ---------- backup, restauração e importação ----------
const COLS_P = ['numero', 'status', 'cliente', 'projeto', 'responsavel', 'data', 'validade', 'objetivo', 'entregas', 'etapas', 'prazos', 'imposto_pct', 'desconto_pct', 'faixa', 'token', 'briefing', 'pendencias', 'data_envio', 'followup', 'followup_n', 'contato_nome', 'contato_whatsapp', 'contato_email', 'briefing_texto', 'resposta_data', 'resposta_nome', 'resposta_obs', 'resposta_meta', 'cliente_id', 'pag_entrada', 'pag_entrada_txt', 'pag_resto_txt', 'pag_formas', 'pag_obs'];
async function backup(db) {
  const cfg = await cfgAll(db); delete cfg.n8n_key; delete cfg.ultimo_poll; delete cfg.ultimo_tally;
  return { versao: 1, gerado: new Date().toISOString(),
    propostas: (await db.prepare('SELECT ' + COLS_P.join(',') + ' FROM propostas ORDER BY criado_em, numero').all()).results,
    itens: (await db.prepare('SELECT numero,ordem,servico,descricao,observacao,qtd,valor_unit FROM itens ORDER BY numero,ordem,id').all()).results,
    catalogo: (await db.prepare('SELECT servico,descricao,condicao,faixa1,faixa2,categoria FROM catalogo ORDER BY ordem,id').all()).results,
    condicoes: (await db.prepare('SELECT titulo,texto FROM condicoes ORDER BY ordem,id').all()).results,
    clientes: (await db.prepare('SELECT id,' + CLI.join(',') + ' FROM clientes ORDER BY id').all()).results, config: cfg };
}
const stP = (db, p) => {
  const v = {}; COLS_P.forEach(k => v[k] = p[k] == null ? '' : p[k]);
  if (!v.numero) throw new Falha('Linha de proposta sem número.');
  if (!v.token) v.token = rnd(8);
  v.status = ST.indexOf(v.status) >= 0 ? v.status : 'Rascunho';
  ['imposto_pct', 'desconto_pct'].forEach(k => v[k] = typeof p[k] === 'number' ? p[k] : (String(p[k] || '') === '' ? (k === 'imposto_pct' ? 6 : 0) : num(p[k])));
  v.faixa = num(v.faixa) === 2 ? 2 : 1; v.followup_n = Math.round(num(v.followup_n));
  v.contato_whatsapp = fone(v.contato_whatsapp);
  const cid = Math.round(num(p.cliente_id)); v.cliente_id = cid > 0 ? cid : null;
  v.pag_entrada = String(p.pag_entrada == null ? '' : p.pag_entrada) === '' ? -1 : (typeof p.pag_entrada === 'number' ? p.pag_entrada : num(p.pag_entrada));
  const cols = COLS_P, up = cols.filter(c => c !== 'numero').map(c => `${c}=excluded.${c}`).join(',');
  return db.prepare(`INSERT INTO propostas(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')}) ON CONFLICT(numero) DO UPDATE SET ${up}`).bind(...cols.map(c => c === 'cliente_id' || c === 'pag_entrada' ? v[c] : cut(v[c], 30000)));
};
const stI = (db, i, k) => db.prepare('INSERT INTO itens(numero,ordem,servico,descricao,observacao,qtd,valor_unit) VALUES(?,?,?,?,?,?,?)')
  .bind(cut(i.numero, 40), k, cut(i.servico, 200), cut(i.descricao, 1000), cut(i.observacao, 1000), typeof i.qtd === 'number' ? i.qtd : (num(i.qtd) || 1),
    typeof i.valor_unit === 'number' ? i.valor_unit : (num(i.valor_unit) || (num(i.valor) / (num(i.qtd) || 1))));
const stC = (db, c, k) => db.prepare('INSERT INTO catalogo(ordem,servico,descricao,condicao,faixa1,faixa2,categoria) VALUES(?,?,?,?,?,?,?)')
  .bind(k, cut(c.servico, 200), cut(c.descricao, 1000), cut(c.condicao, 1000), typeof c.faixa1 === 'number' ? c.faixa1 : num(c.faixa1), typeof c.faixa2 === 'number' ? c.faixa2 : num(c.faixa2), cut(c.categoria, 80) || 'Serviços');
const stD = (db, c, k) => db.prepare('INSERT INTO condicoes(ordem,titulo,texto) VALUES(?,?,?)').bind(k, cut(c.titulo, 200), cut(c.texto, 5000));

async function restaurar(db, b) {
  if (!b || b.versao !== 1 || !Array.isArray(b.propostas)) throw new Falha('Este arquivo não parece um backup do sistema.');
  const st = [db.prepare('DELETE FROM itens'), db.prepare('DELETE FROM propostas'), db.prepare('DELETE FROM catalogo'), db.prepare('DELETE FROM condicoes'), db.prepare('DELETE FROM clientes'), db.prepare("DELETE FROM config WHERE chave<>'n8n_key'")];
  b.propostas.forEach(p => st.push(stP(db, p)));
  (b.itens || []).forEach((i, k) => st.push(stI(db, i, i.ordem != null ? i.ordem : k)));
  (b.catalogo || []).forEach((c, k) => st.push(stC(db, c, k)));
  (b.condicoes || []).forEach((c, k) => st.push(stD(db, c, k)));
  (b.clientes || []).forEach(c => st.push(db.prepare(`INSERT INTO clientes(id,${CLI.join(',')}) VALUES(?,${CLI.map(() => '?').join(',')})`).bind(Math.round(num(c.id)) || null, ...CLI.map(k => cut(c[k], k === 'obs' ? 2000 : 300)))));
  Object.keys(b.config || {}).filter(k => k !== 'n8n_key').forEach(k => st.push(db.prepare('INSERT INTO config(chave,valor) VALUES(?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor').bind(cut(k, 80), cut(b.config[k], 5000))));
  await db.batch(st);
}
// linhas vindas dos CSV da planilha antiga
async function importar(db, tabela, rows) {
  if (!Array.isArray(rows)) throw new Falha('Nada para importar.');
  try {
    if (tabela === 'propostas') {
      const tk = new Map((await db.prepare('SELECT numero,token FROM propostas').all()).results.map(x => [x.token, x.numero])), avisos = [], porNumero = new Map(), st = [];
      rows.filter(r => r.numero && String(r.numero).trim()).forEach(r => porNumero.set(String(r.numero).trim(), r));   // se o número repete, vale a última linha
      for (const [numero, r] of porNumero) {
        r.numero = numero; let t = String(r.token || '').trim();
        if (!t || (tk.has(t) && tk.get(t) !== numero)) { if (t) avisos.push(`${numero}: o código do link já pertencia a ${tk.get(t)}; esta proposta ganhou um link novo.`); t = rnd(8); r.token = t; }
        tk.set(t, numero); st.push(stP(db, r));
      }
      await db.batch(st); return { qtd: st.length, avisos };
    }
    if (tabela === 'itens') {
      const nums = [...new Set(rows.map(r => r.numero).filter(Boolean))], st = [], cont = {};
      nums.forEach(n => st.push(db.prepare('DELETE FROM itens WHERE numero=?').bind(n)));
      rows.filter(r => r.numero && r.servico).forEach(r => { cont[r.numero] = (cont[r.numero] || 0); st.push(stI(db, r, cont[r.numero]++)); });
      await db.batch(st); return { qtd: rows.length };
    }
    if (tabela === 'catalogo') { const ok = rows.filter(r => r.servico); if (!ok.length) throw new Falha('Catálogo vazio.'); await db.batch([db.prepare('DELETE FROM catalogo'), ...ok.map((c, k) => stC(db, c, k))]); return { qtd: ok.length }; }
    if (tabela === 'condicoes') { const ok = rows.filter(r => r.titulo); if (!ok.length) throw new Falha('Condições vazias.'); await db.batch([db.prepare('DELETE FROM condicoes'), ...ok.map((c, k) => stD(db, c, k))]); return { qtd: ok.length }; }
    if (tabela === 'config') {
      const ok = rows.filter(r => r.chave && r.chave !== 'n8n_key' && r.chave !== 'link_base');
      await cfgSet(db, Object.fromEntries(ok.map(r => [r.chave, r.valor]))); return { qtd: ok.length };
    }
    if (tabela === 'clientes') return await importarClientes(db, rows);
    if (tabela === 'briefings_csv') {
      const out = [];
      for (const row of rows) { const r = await receberBriefing(db, organizarCsv(row), idCsv(row), true); out.push(r.numero + (r.repetido ? ' (já existia)' : '')); }
      return { qtd: out.length, numeros: out };
    }
    if (tabela === 'briefings') {
      const out = [];
      for (const c of rows) { const d = c.data || {}, r = await receberBriefing(db, organizarTally(c), d.responseId || d.submissionId || c.id || c.submissionId || c.eventId || null, true); out.push(r.numero + (r.repetido ? ' (já existia)' : '')); }
      return { qtd: out.length, numeros: out };
    }
  } catch (e) { if (e instanceof Falha) throw e; throw new Falha(`Não consegui importar "${tabela}": ${String(e.message || e).replace(/^D1_ERROR:\s*/, '').slice(0, 160)}`); }
  throw new Falha('Tabela desconhecida.');
}

// ---------- rotas da API ----------
const CFG_PUB = ['empresa_nome', 'empresa_cnpj', 'empresa_email', 'empresa_site', 'empresa_fone', 'empresa_wa', 'banco', 'aviso_email', 'aviso_whatsapp', 'prefixo', 'validade_padrao', 'imposto_padrao', 'texto_agradecimento', 'prazo_proposta', 'auto_briefing', 'auto_aprovada', 'dominio_publico', 'incorporar_em', 'aviso_visualizacao', 'pag_entrada_padrao', 'pag_entrada_txt_padrao', 'pag_resto_txt_padrao', 'pag_formas_padrao', 'pag_obs_padrao', ...Object.keys(MSG_PADRAO)];

async function api(req, env, u, path, m) {
  const db = env.DB, https = u.protocol === 'https:';
  // --- públicas ---
  if (path === '/api/estado' && m === 'GET') return json({ ok: true, versao: VERSAO, setup: !(await db.prepare('SELECT 1 x FROM usuarios LIMIT 1').first()), logado: !!(await quemE(req, env)) });
  if (path === '/api/setup' && m === 'POST') {
    if (await db.prepare('SELECT 1 x FROM usuarios LIMIT 1').first()) return erro('O sistema já foi configurado.', 403);
    if (!env.CHAVE_INSTALACAO) return erro('Falta criar a variável CHAVE_INSTALACAO nas configurações do Worker.', 500);
    const b = await lerJson(req);
    if (!iguais(b.chave || '', env.CHAVE_INSTALACAO)) return erro('Chave de instalação incorreta.', 403);
    const login = await salvarUsuario(db, b.login, b.senha);
    return json({ ok: true }, 200, { 'Set-Cookie': await abrirSessao(db, login, https) });
  }
  if (path === '/api/recuperar' && m === 'POST') {
    const ip = req.headers.get('CF-Connecting-IP') || 'x';
    await db.prepare('DELETE FROM falhas WHERE ts<?').bind(Date.now() - 900000).run();
    if (await db.prepare('SELECT COUNT(*) c FROM falhas WHERE ip=?').bind(ip).first('c') >= 10) return erro('Muitas tentativas. Aguarde 15 minutos.', 429);
    if (!env.CHAVE_INSTALACAO) return erro('Falta a variável CHAVE_INSTALACAO nas configurações do Worker.', 500);
    const b = await lerJson(req);
    if (!iguais(b.chave || '', env.CHAVE_INSTALACAO)) { await db.prepare('INSERT INTO falhas(ip,ts) VALUES(?,?)').bind(ip, Date.now()).run(); return erro('Chave de instalação incorreta.', 403); }
    const login = await salvarUsuario(db, b.login, b.senha);
    await db.prepare("UPDATE usuarios SET totp='',totp_pend='' WHERE login=?").bind(login).run();      // recuperar acesso também desliga a 2ª etapa
    return json({ ok: true }, 200, { 'Set-Cookie': await abrirSessao(db, login, https) });
  }
  if (path === '/api/login' && m === 'POST') {
    const ip = req.headers.get('CF-Connecting-IP') || 'x';
    await db.prepare('DELETE FROM falhas WHERE ts<?').bind(Date.now() - 900000).run();
    if (await db.prepare('SELECT COUNT(*) c FROM falhas WHERE ip=?').bind(ip).first('c') >= 10) return erro('Muitas tentativas. Aguarde 15 minutos.', 429);
    const b = await lerJson(req), l = String(b.login || '').trim().toLowerCase(), s = String(b.senha || '');
    const usr = await db.prepare('SELECT sal,hash,totp FROM usuarios WHERE login=?').bind(l).first();
    let ok = false;
    if (usr) { const [it, h] = usr.hash.split(':'); ok = iguais(await pbkdf2(s, usr.sal, +it), h); } else await pbkdf2(s, 'sem-usuario-0000', ITER);
    if (!ok) { await db.prepare('INSERT INTO falhas(ip,ts) VALUES(?,?)').bind(ip, Date.now()).run(); return erro('Login ou senha inválidos.', 401); }
    if (usr.totp) {
      if (!b.codigo) return json({ ok: false, precisa2fa: true, erro: 'Digite o código de 6 dígitos do seu aplicativo autenticador.' }, 401);
      if (!await totpOk(usr.totp, b.codigo)) { await db.prepare('INSERT INTO falhas(ip,ts) VALUES(?,?)').bind(ip, Date.now()).run(); return erro('Código inválido ou expirado.', 401); }
    }
    return json({ ok: true }, 200, { 'Set-Cookie': await abrirSessao(db, l, https) });
  }
  if (path.startsWith('/api/p/')) {                                  // página do cliente
    const [, , , t, sub] = path.split('/');
    if (!/^[A-Za-z0-9]{8,32}$/.test(t || '')) return erro('Link inválido.', 404);
    if (!sub && m === 'GET') { if (u.searchParams.get('rev') !== '1') { try { await registrarVisita(req, env, db, t); } catch (e) {} } }
    if (!sub && m === 'GET') return json(await dadosPublicos(db, t, u.searchParams.get('rev') === '1', u.origin));
    if (sub === 'resposta' && m === 'POST') return json(await responder(db, t, await lerJson(req), u.origin, (req.headers.get('CF-Connecting-IP') || '?') + ' · ' + (req.headers.get('User-Agent') || '').slice(0, 160)));
  }
  // --- automações (chave) ---
  if (['/api/tally', '/api/briefing', '/api/saidas', '/api/saidas_ok', '/api/backup_auto'].includes(path)) {
    if (!await chaveOk(env, u.searchParams.get('k') || '')) {
      if (path === '/api/briefing' && m === 'POST') { const b = await lerJson(req); if (!await chaveOk(env, b.k)) return erro('chave', 401); return json(await receberBriefing(db, b.dados || {}, null, false, u.origin)); }
      return erro('chave', 401);
    }
    if (path === '/api/tally' && m === 'POST') {
      await cfgSet(db, { ultimo_tally: new Date().toISOString() });
      const lista = [].concat(await lerJson(req)), res = [];
      for (const c of lista) { const d = c.data || {}; res.push(await receberBriefing(db, organizarTally(c), d.responseId || d.submissionId || c.id || c.submissionId || c.eventId || null, false, u.origin)); }
      return json(res.length === 1 ? res[0] : { ok: true, resultados: res });
    }
    if (path === '/api/briefing' && m === 'POST') { await cfgSet(db, { ultimo_tally: new Date().toISOString() }); const b = await lerJson(req); return json(await receberBriefing(db, b.dados || {}, null, false, u.origin)); }
    if (path === '/api/saidas') { await cfgSet(db, { ultimo_poll: new Date().toISOString() }); return json({ ok: true, itens: await saidas(db, u.origin) }); }
    if (path === '/api/backup_auto') return new Response(JSON.stringify(await backup(db), null, 1), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="backup-propostas-${new Date().toISOString().slice(0, 10)}.json"`, ...SEC } });
    if (path === '/api/saidas_ok') return json(await saidaOk(db, u.searchParams.get('tipo'), u.searchParams.get('ref'), u.searchParams.get('wa'), u.searchParams.get('em')));
  }
  // --- daqui para baixo: só logado ---
  const eu = await quemE(req, env);
  if (!eu) return erro('Sessão expirada. Entre de novo.', 401);
  const sf = req.headers.get('Sec-Fetch-Site');
  if (m !== 'GET' && sf && sf !== 'same-origin' && sf !== 'none') return erro('Origem não permitida.', 403);

  if (path === '/api/logout' && m === 'POST') { await db.prepare('DELETE FROM sessoes WHERE hash=?').bind(await sha256(cookie(req, 'sid'))).run(); return json({ ok: true }, 200, { 'Set-Cookie': 'sid=; Path=/; Max-Age=0' }); }
  if (path === '/api/dados' && m === 'GET') { const cfg0 = await cfgAll(db), d = await listarTudo(db, baseUrl(cfg0, u.origin)); d.config = cfg0; delete d.config.n8n_key; d.usuario = eu; d.padroes = MSG_PADRAO; d.clientes = await listarClientes(db); d.pag_padrao = pagPadrao(cfg0); return json({ ok: true, ...d }); }
  if (path === '/api/nova' && m === 'POST') {
    const b = await lerJson(req).catch(() => ({})), ini = {}, id = Math.round(nj(b.cliente_id, 0));
    if (id > 0) { const c = await db.prepare('SELECT * FROM clientes WHERE id=?').bind(id).first(); if (c) Object.assign(ini, { cliente: c.empresa, contato_nome: c.contato_nome, contato_whatsapp: c.contato_whatsapp, contato_email: c.contato_email, cliente_id: c.id }); }
    return json({ ok: true, numero: await criarProposta(db, ini) });
  }
  if (path === '/api/clientes' && m === 'GET') return json({ ok: true, itens: await listarClientes(db) });
  if (path === '/api/clientes' && m === 'POST') return json({ ok: true, id: await salvarCliente(db, await lerJson(req)) });
  if (path === '/api/clientes/remover' && m === 'POST') { const id = Math.round(nj((await lerJson(req)).id, 0)); await db.batch([db.prepare('UPDATE propostas SET cliente_id=NULL WHERE cliente_id=?').bind(id), db.prepare('DELETE FROM clientes WHERE id=?').bind(id)]); return json({ ok: true }); }
  if (path === '/api/2fa/iniciar' && m === 'POST') {
    const seg = b32enc(crypto.getRandomValues(new Uint8Array(20)));
    await db.prepare('UPDATE usuarios SET totp_pend=? WHERE login=?').bind(seg, eu).run();
    return json({ ok: true, segredo: seg, uri: `otpauth://totp/Propostas:${encodeURIComponent(eu)}?secret=${seg}&issuer=Propostas` });
  }
  if (path === '/api/2fa/ativar' && m === 'POST') {
    const b = await lerJson(req), r = await db.prepare('SELECT totp_pend p FROM usuarios WHERE login=?').bind(eu).first();
    if (!r || !r.p) throw new Falha('Comece pela opção Ativar.');
    if (!await totpOk(r.p, b.codigo)) throw new Falha('Código incorreto. Confira o horário do celular e tente o próximo código.');
    await db.prepare("UPDATE usuarios SET totp=?, totp_pend='' WHERE login=?").bind(r.p, eu).run(); return json({ ok: true });
  }
  if (path === '/api/2fa/desativar' && m === 'POST') {
    const b = await lerJson(req), me = await db.prepare('SELECT sal,hash FROM usuarios WHERE login=?').bind(eu).first(), [it, h] = me.hash.split(':');
    if (!iguais(await pbkdf2(String(b.senha || ''), me.sal, +it), h)) throw new Falha('Senha incorreta.', 403);
    await db.prepare("UPDATE usuarios SET totp='',totp_pend='' WHERE login=?").bind(eu).run(); return json({ ok: true });
  }
  if (path === '/api/sessoes/encerrar' && m === 'POST') { await db.prepare('DELETE FROM sessoes WHERE login=? AND hash<>?').bind(eu, await sha256(cookie(req, 'sid'))).run(); return json({ ok: true }); }
  if (path === '/api/testar_dominio' && m === 'POST') {
    const b = await lerJson(req); let host = ''; try { host = new URL(String(b.dominio || '')).hostname; } catch (e) {}
    if (!host) throw new Falha('Endereço inválido.');
    try {
      const r = await fetch('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(host) + '&type=A', { headers: { accept: 'application/dns-json' } }), j = await r.json();
      return json({ ok: true, verificado: true, host, existe: j.Status === 0 && Array.isArray(j.Answer) && j.Answer.length > 0 });
    } catch (e) { return json({ ok: true, verificado: false, host }); }
  }
  if (path === '/api/proposta' && m === 'POST') { await salvarProposta(db, await lerJson(req)); return json({ ok: true }); }
  if (path === '/api/excluir' && m === 'POST') { const b = await lerJson(req); await excluirProposta(db, String(b.numero || '')); return json({ ok: true }); }
  if (path === '/api/duplicar' && m === 'POST') { const b = await lerJson(req); return json({ ok: true, numero: await duplicarProposta(db, String(b.numero || '')) }); }

  if (path === '/api/catalogo' && m === 'POST') {
    const b = await lerJson(req); if (!Array.isArray(b.itens) || !b.itens.length) throw new Falha('O catálogo não pode ficar vazio.');
    await db.batch([db.prepare('DELETE FROM catalogo'), ...b.itens.filter(c => String(c.servico || '').trim()).map((c, k) => stC(db, { ...c, faixa1: nj(c.faixa1), faixa2: nj(c.faixa2) }, k))]); return json({ ok: true });
  }
  if (path === '/api/condicoes' && m === 'GET') return json({ ok: true, itens: (await db.prepare('SELECT titulo,texto FROM condicoes ORDER BY ordem,id').all()).results });
  if (path === '/api/condicoes' && m === 'POST') {
    const b = await lerJson(req); if (!Array.isArray(b.itens)) throw new Falha('Pedido inválido.');
    await db.batch([db.prepare('DELETE FROM condicoes'), ...b.itens.filter(c => String(c.titulo || '').trim()).map((c, k) => stD(db, c, k))]); return json({ ok: true });
  }
  if (path === '/api/config' && m === 'GET') {
    const c = await cfgAll(db), o = {}; CFG_PUB.forEach(k => o[k] = c[k] || '');
    const us = (await db.prepare("SELECT login,criado,(totp<>'') AS dois FROM usuarios ORDER BY login").all()).results;
    const cnt = async w => (await db.prepare('SELECT COUNT(*) c FROM avisos WHERE ' + w).first('c')) || 0;
    const status = { ultimo_poll: c.ultimo_poll || '', ultimo_tally: c.ultimo_tally || '', fila: await cnt('enviado<=0 AND enviado>-3'), desistidos: await cnt('enviado<=-3'),
      avisos: (await db.prepare('SELECT id,criado,assunto,whatsapp,email,enviado FROM avisos ORDER BY id DESC LIMIT 12').all()).results };
    return json({ ok: true, config: o, usuarios: us, chave: c.n8n_key || '', origem: u.origin, padroes: MSG_PADRAO, status });
  }
  if (path === '/api/config' && m === 'POST') {
    const b = await lerJson(req), o = {}; CFG_PUB.forEach(k => { if (b[k] !== undefined) o[k] = String(b[k]).trim(); });
    if (o.prefixo !== undefined && o.prefixo !== '' && !/^[A-Za-z0-9]{1,6}$/.test(o.prefixo)) throw new Falha('Prefixo da numeração: use de 1 a 6 letras ou números, sem hífen nem espaço (ex.: REC). O ano e o mês entram sozinhos.');
    if (o.imposto_padrao !== undefined && o.imposto_padrao !== '' && !(isFinite(Number(o.imposto_padrao)) && Number(o.imposto_padrao) >= 0 && Number(o.imposto_padrao) <= 100)) throw new Falha('Imposto padrão: informe um número entre 0 e 100 (ex.: 6).');
    if (o.pag_entrada_padrao !== undefined && o.pag_entrada_padrao !== '' && !(isFinite(Number(o.pag_entrada_padrao)) && Number(o.pag_entrada_padrao) >= 0 && Number(o.pag_entrada_padrao) <= 100)) throw new Falha('Sinal padrão: informe um número entre 0 e 100 (ex.: 30).');
    if (o.validade_padrao !== undefined && o.validade_padrao.length > 40) throw new Falha('Validade padrão: use um texto curto (ex.: 15 dias).');
    if (o.dominio_publico !== undefined && o.dominio_publico !== '' && !/^https:\/\/[a-z0-9.-]+$/i.test(o.dominio_publico)) throw new Falha('Endereço público: use o formato https://proposta.seudominio.com.br (sem barra no final).');
    if (o.incorporar_em !== undefined && o.incorporar_em !== '' && !o.incorporar_em.split(/[\s,]+/).filter(Boolean).every(x => /^https:\/\/[a-z0-9.-]+$/i.test(x))) throw new Falha('Sites autorizados: use endereços completos separados por espaço, como https://www.seusite.com.br');
    await cfgSet(db, o); return json({ ok: true });
  }
  if (path === '/api/aviso_teste' && m === 'POST') {
    const cfg = await cfgAll(db); if (!fone(cfg.aviso_whatsapp) && !String(cfg.aviso_email || '').trim()) throw new Falha('Preencha o WhatsApp ou o e-mail para avisos e salve antes de testar.');
    await novoAviso(db, 'Teste de aviso', '✅ Teste do sistema de propostas. Se você recebeu esta mensagem, os avisos por WhatsApp e e-mail estão funcionando.');
    return json({ ok: true, whatsapp: fone(cfg.aviso_whatsapp), email: cfg.aviso_email || '' });
  }
  if (path === '/api/chave' && m === 'POST') { const k = rnd(16); await cfgSet(db, { n8n_key: k }); return json({ ok: true, chave: k }); }
  if (path === '/api/usuario' && m === 'POST') { const b = await lerJson(req); await salvarUsuario(db, b.login, b.senha); return json({ ok: true }); }
  if (path === '/api/usuario/remover' && m === 'POST') {
    const b = await lerJson(req), l = String(b.login || '').toLowerCase();
    if (l === eu) throw new Falha('Você não pode remover o usuário com que está logado.');
    await db.batch([db.prepare('DELETE FROM sessoes WHERE login=?').bind(l), db.prepare('DELETE FROM usuarios WHERE login=?').bind(l)]); return json({ ok: true });
  }
  if (path === '/api/backup' && m === 'GET') return new Response(JSON.stringify(await backup(db), null, 1), { headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="backup-propostas-${new Date().toISOString().slice(0, 10)}.json"`, ...SEC } });
  if (path === '/api/restaurar' && m === 'POST') { await restaurar(db, await lerJson(req)); return json({ ok: true }); }
  if (path === '/api/importar' && m === 'POST') { const b = await lerJson(req); return json({ ok: true, ...await importar(db, b.tabela, b.linhas) }); }
  return erro('Rota não encontrada.', 404);
}

// ---------- entrada ----------
async function paginaProposta(env, t, rev, origin) {
  const p = await env.DB.prepare('SELECT numero,cliente,projeto,validade FROM propostas WHERE token=?').bind(t).first();
  if (!p) return page('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><body style="font:18px sans-serif;padding:40px"><p>Proposta não encontrada. Confira o link com quem enviou.</p>', 404);
  const cfg = await cfgAll(env.DB), emp = cfg.empresa_nome || 'RECording', base = baseUrl(cfg, origin);
  const titulo = escH('Proposta ' + p.numero + (p.cliente ? ' - ' + p.cliente : '')).replace(/&quot;/g, '');
  const ogT = escH('Proposta comercial' + (p.cliente ? ' · ' + p.cliente : '')), ogD = escH((p.projeto ? p.projeto + ' · ' : '') + emp + '. Veja o escopo, os prazos e o investimento.');
  const tags = `<title>${titulo}</title><meta property="og:type" content="website"><meta property="og:title" content="${ogT}"><meta property="og:description" content="${ogD}"><meta property="og:image" content="${base}/og.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta name="twitter:card" content="summary_large_image">`;
  const html = INDEX_HTML.replace('__Q__', () => JSON.stringify({ t, rev: rev ? '1' : '' })).replace(/<title>.*?<\/title>/, () => tags);
  return page(html, 200, { 'Content-Security-Policy': CSP });
}

export default {
  async fetch(req, env) {
    try {
      if (!env.DB) return page('<!doctype html><meta charset="utf-8"><body style="font:18px sans-serif;padding:40px"><h2>Falta ligar o banco</h2><p>No Worker: Settings → Bindings → Add → D1 database. Em "Variable name" escreva <b>DB</b> e escolha o banco.</p>', 500);
      await garantirSchema(env.DB);
      const u = new URL(req.url), path = u.pathname.replace(/\/+$/, '') || '/', m = req.method;
      if (path === '/') return Response.redirect(u.origin + '/painel', 302);
      if (path === '/favicon.ico' || path === '/favicon.png') return new Response(bytes(FAV64), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
      if (path === '/og.png') return new Response(bytes(OG_PNG), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
      if (path === '/apple-touch-icon.png') return new Response(bytes(FAV180), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' } });
      if (path === '/painel') {
        const fa = String((await cfgAll(env.DB)).incorporar_em || '').split(/[\s,]+/).filter(x => /^https:\/\/[a-z0-9.-]+$/i.test(x));
        return page(PAINEL_HTML, 200, { 'Content-Security-Policy': CSP + '; frame-ancestors ' + (fa.length ? fa.join(' ') : "'none'") });
      }
      if (path.startsWith('/api/')) return await api(req, env, u, path, m);
      const t = path.slice(1);
      if (/^[A-Za-z0-9]{8,32}$/.test(t) && m === 'GET') return await paginaProposta(env, t, u.searchParams.get('rev') === '1', u.origin);
      return page('<!doctype html><meta charset="utf-8"><body style="font:18px sans-serif;padding:40px"><p>Página não encontrada.</p>', 404);
    } catch (e) {
      if (e instanceof Falha) return erro(e.message, e.status);
      console.error(e && e.stack || e);
      return erro('Erro interno: ' + String(e && e.message || e).slice(0, 200), 500);
    }
  }
};
