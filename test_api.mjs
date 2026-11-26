import { D1 } from './d1shim.mjs';
import fs from 'node:fs';
const RealDate = Date;
const setNow = iso => { globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(iso); } static now() { return new RealDate(iso).getTime(); } }; };
const W = (await import('./worker.mjs?' + Math.random())).default;
let env = { DB: new D1() }, falhas = 0, n = 0;
const ok = (c, t, x) => { n++; if (!c) { falhas++; console.log('  ✗ FALHOU:', t, x !== undefined ? JSON.stringify(x).slice(0, 200) : ''); } else console.log('  ✓', t); };
let cookie = '';
const call = async (path, o = {}) => { const h = { ...(o.headers || {}) }; if (cookie && !o.semCookie) h.Cookie = cookie; if (o.body && typeof o.body !== 'string') { o.body = JSON.stringify(o.body); h['Content-Type'] = 'application/json'; }
  const r = await W.fetch(new Request('https://propostas.exemplo.workers.dev' + path, { method: o.method || (o.body ? 'POST' : 'GET'), headers: h, body: o.body }), env);
  const sc = r.headers.get('Set-Cookie'); if (sc && sc.startsWith('sid=') && !sc.startsWith('sid=;')) cookie = sc.split(';')[0]; if (sc && sc.startsWith('sid=;')) cookie = '';
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (e) {} return { s: r.status, j, t, h: r.headers }; };
const tallyHook = (id, extra = {}) => ({ eventId: 'ev' + id, eventType: 'FORM_RESPONSE', data: { responseId: id, fields: [
  { key: 'a', label: 'Nome e Sobrenome', type: 'INPUT_TEXT', value: 'Maria Souza' }, { key: 'b', label: 'Email', type: 'INPUT_EMAIL', value: 'maria@rex.com' },
  { key: 'c', label: 'Telefone', type: 'INPUT_PHONE_NUMBER', value: '+5511900000000' }, { key: 'd', label: 'Organização', type: 'INPUT_TEXT', value: 'REX RECICLAGEM' },
  { key: 'e', label: 'Quais produtos ou serviços serão abordados nesta ação?', type: 'TEXTAREA', value: 'Rodapé de proteção' },
  { key: 'f', label: 'Quais os principais objetivos desta ação?', type: 'TEXTAREA', value: 'Mostrar o produto' },
  { key: 'g', label: 'Locais', type: 'CHECKBOXES', value: ['x1'], options: [{ id: 'x1', text: 'Websites' }] },
  { key: 'h', label: 'O que achou deste Briefing?', type: 'RATING', value: 5 }], ...extra } });

console.log('\n[1] Instalação e login');
let r = await call('/painel'); ok(r.s === 200 && /Primeiro acesso|Gerador de propostas/.test(r.t) && /frame-ancestors 'none'/.test(r.h.get('Content-Security-Policy')), 'painel abre com cabeçalhos de segurança');
r = await call('/api/estado'); ok(r.j.setup === true && r.j.logado === false, 'estado: precisa de primeiro acesso');
ok(/^v\d+\.\d+/.test(r.j.versao || ''), 'estado informa a versão do sistema (para conferir qual código está no ar)', r.j);
r = await call('/api/setup', { body: { chave: 'x', login: 'admin', senha: 'senha123456' } }); ok(r.s === 500 && /CHAVE_INSTALACAO/.test(r.j.erro), 'sem variável CHAVE_INSTALACAO: mensagem clara');
env.CHAVE_INSTALACAO = 'chave-secreta-de-instalacao';
r = await call('/api/setup', { body: { chave: 'errada', login: 'admin', senha: 'senha123456' } }); ok(r.s === 403, 'chave de instalação errada é recusada');
r = await call('/api/setup', { body: { chave: env.CHAVE_INSTALACAO, login: 'admin', senha: '123' } }); ok(r.s === 400, 'senha curta recusada');
r = await call('/api/setup', { body: { chave: env.CHAVE_INSTALACAO, login: 'admin', senha: 'senha123456' } }); ok(r.j.ok && cookie.startsWith('sid='), 'primeiro usuário criado e já logado');
r = await call('/api/setup', { body: { chave: env.CHAVE_INSTALACAO, login: 'intruso', senha: 'senha123456' } }); ok(r.s === 403, 'setup não funciona uma segunda vez');
r = await call('/api/dados', { semCookie: true }); ok(r.s === 401, 'API protegida sem sessão');
r = await call('/api/dados'); ok(r.j.ok && r.j.usuario === 'admin' && Array.isArray(r.j.propostas), 'API com sessão funciona');
const ck = cookie; cookie = '';
r = await call('/api/login', { body: { login: 'admin', senha: 'errada123' } }); ok(r.s === 401, 'senha errada: 401');
r = await call('/api/login', { body: { login: 'admin', senha: 'senha123456' } }); ok(r.j.ok && /HttpOnly/.test(r.h.get('Set-Cookie')) && /SameSite=Strict/.test(r.h.get('Set-Cookie')) && /Secure/.test(r.h.get('Set-Cookie')), 'login ok, cookie HttpOnly+Secure+Strict');
for (let i = 0; i < 10; i++) await call('/api/login', { body: { login: 'x', senha: 'y' }, semCookie: true });
r = await call('/api/login', { body: { login: 'admin', senha: 'senha123456' } }); ok(r.s === 429, 'bloqueio após muitas tentativas');
env.DB.db.exec('DELETE FROM falhas');

console.log('\n[2] Automação: chave, Tally e dedupe');
r = await call('/api/tally?k=qualquer', { body: tallyHook('R1'), semCookie: true }); ok(r.s === 401, 'Tally sem chave válida é recusado');
r = await call('/api/chave', { body: {} }); let K = r.j.chave; ok(/^[0-9a-f]{32}$/.test(K), 'chave gerada');
await call('/api/config', { body: { aviso_whatsapp: '(11) 90000-0000', aviso_email: 'equipe@x.com', empresa_nome: 'Minha Produtora', banco: 'Banco X\nAg 1 <b>Conta</b> 2' } });
r = await call('/api/tally?k=' + K, { body: tallyHook('R1'), semCookie: true }); const N1 = r.j.numero; ok(r.j.ok && /^REC-\d{4}-001$/.test(N1), 'briefing do Tally vira proposta ' + N1, r.j);
r = await call('/api/tally?k=' + K, { body: tallyHook('R1'), semCookie: true }); ok(r.j.repetido && r.j.numero === N1, 'reenvio do mesmo briefing não duplica');
r = await call('/api/tally?k=' + K, { body: tallyHook('R2'), semCookie: true }); ok(/-002$/.test(r.j.numero), 'segundo briefing recebe -002');
const mock = JSON.parse(fs.readFileSync('./examples/mock_briefing_tally_node.json', 'utf8'))[0];
r = await call('/api/tally?k=' + K, { body: mock, semCookie: true }); ok(r.j.ok && /-003$/.test(r.j.numero), 'formato do nó Tally Trigger (seu mock) também é aceito');
r = await call('/api/briefing', { body: { k: K, dados: { cliente: 'LEGADO', projeto: 'p' } }, semCookie: true }); ok(r.j.ok, 'rota antiga /api/briefing {k,dados} continua funcionando');
r = await call('/api/briefing', { body: { k: 'x', dados: {} }, semCookie: true }); ok(r.s === 401, '/api/briefing com chave errada recusa');
r = await call('/api/dados'); const P1 = r.j.propostas.find(p => p.numero === N1), P3 = r.j.propostas.find(p => p.cliente === 'EMPRESA TESTE');
ok(P1.cliente === 'REX RECICLAGEM' && P1.contato_whatsapp === '5511900000000' && P1.status === 'Briefing' && P1.briefing === 'Sim' && P1.token.length === 16, 'campos do briefing organizados', { c: P1.cliente, w: P1.contato_whatsapp });
ok(!/achou deste/.test(P1.briefing_texto) && /Websites/.test(P1.briefing_texto), 'briefing_texto sem a nota do formulário e com opções legíveis');
ok(P3 && /Maria/.test(P3.contato_nome) && P3.briefing_texto.length > 1000, 'mock: cliente EMPRESA TESTE e briefing completo');

console.log('\n[3] Montar e enviar proposta');
r = await call('/api/proposta', { body: { numero: N1, status: 'Enviada', projeto: 'Rodapé', imposto_pct: 6, desconto_pct: 0, faixa: 1, validade: '15 dias', data_envio: '16/10/2026', followup: '16/10/2026', entregas: 'Vídeo | 1 min', prazos: 'Entrega | Prazo | 30/10', etapas: 'Briefing, Entrega',
  itens: [{ servico: 'Captação', descricao: 'd', observacao: 'o', qtd: 2, valor_unit: 1000 }, { servico: '', qtd: 1, valor_unit: 5 }] } }); ok(r.j.ok, 'proposta salva');
r = await call('/api/dados'); const E = r.j.propostas.find(p => p.numero === N1); ok(E.itens.length === 1 && E.t.total === 2120 && E.status === 'Enviada', 'item gravado, linha vazia descartada, total R$ 2.120,00', E.t);
r = await call('/api/proposta', { body: { numero: N1, status: 'Hackeado' } }); ok(r.s === 400, 'status inválido recusado');
r = await call('/api/proposta', { body: { numero: "x'; DROP TABLE propostas;--", cliente: 'a' } }); ok(r.s === 404, 'número malicioso não passa');
r = await call('/api/dados'); ok(r.j.propostas.length === 4, 'tabela intacta após tentativa de injeção');
r = await call('/api/proposta', { body: { numero: N1, cliente: 'x' }, headers: { 'Sec-Fetch-Site': 'cross-site' } }); ok(r.s === 403, 'pedido de outro site (CSRF) recusado');
r = await call('/api/nova', { body: {} }); ok(/-005$/.test(r.j.numero), 'nova proposta manual ' + r.j.numero); const NN = r.j.numero;
await call('/api/config', { body: { imposto_padrao: '', validade_padrao: '' } }); r = await call('/api/nova', { body: {} }); const dd = (await call('/api/dados')).j.propostas.find(p => p.numero === r.j.numero); ok(dd.imposto_pct === 6 && dd.validade === '15 dias', 'campos de padrão vazios usam 6% e 15 dias (bug do imposto 0 corrigido)', { i: dd.imposto_pct }); await call('/api/excluir', { body: { numero: r.j.numero } });
r = await call('/api/excluir', { body: { numero: NN } }); r = await call('/api/dados'); ok(!r.j.propostas.some(p => p.numero === NN), 'exclusão funciona');

console.log('\n[4] Página do cliente');
r = await call('/' + E.token, { semCookie: true }); ok(r.s === 200 && /<title>Proposta REC-\d{4}-001 - REX RECICLAGEM<\/title>/.test(r.t) && /"t":"/.test(r.t) && !/__Q__/.test(r.t), 'página abre com título e token embutido');
r = await call('/api/p/' + E.token, { semCookie: true }); ok(r.j.ok && r.j.dados.itens.length === 1 && r.j.dados.brand.nome === 'Minha Produtora' && r.j.dados.banco === 'Banco X<br>Ag 1 &lt;b&gt;Conta&lt;/b&gt; 2', 'dados públicos, marca da empresa e banco com escape', r.j.dados && r.j.dados.banco);
r = await call('/api/p/naoexiste0000000', { semCookie: true }); ok(r.j && r.j.ok === false, 'token inexistente não vaza nada');
r = await call('/api/p/' + P3.token, { semCookie: true }); ok(r.j.ok === false && /revisão/.test(r.j.msg), 'proposta em Briefing aparece como "em revisão" para o cliente');
r = await call('/api/p/' + P3.token + '?rev=1', { semCookie: true }); ok(r.j.ok === true, 'com ?rev=1 a equipe consegue ver a prévia');
r = await call('/inexistente123', { semCookie: true }); ok(r.s === 404, 'link inexistente: 404');

console.log('\n[5] Aprovação e recusa pelo cliente');
r = await call('/api/p/' + E.token + '/resposta', { body: { acao: 'aprovar', nome: 'Jo' }, semCookie: true }); ok(r.j.ok === false && /nome completo/.test(r.j.msg), 'aprovar sem nome completo é recusado');
r = await call('/api/p/' + P3.token + '/resposta', { body: { acao: 'aprovar', nome: 'Maria Souza' }, semCookie: true }); ok(r.j.ok === false, 'proposta que ainda não foi enviada não pode ser aprovada');
r = await call('/api/p/' + E.token + '/resposta', { body: { acao: 'aprovar', nome: 'Maria Souza', obs: 'Pode começar' }, semCookie: true }); ok(r.j.ok === true, 'aprovação registrada');
r = await call('/api/p/' + E.token + '/resposta', { body: { acao: 'recusar' }, semCookie: true }); ok(r.j.ok === true && r.j.ja, 'segundo clique (ou recusar depois de aprovar) não muda nada');
r = await call('/api/dados'); const A = r.j.propostas.find(p => p.numero === N1); ok(A.status === 'Fechada' && A.resposta_nome === 'Maria Souza' && /^\d\d\/\d\d\/\d{4} \d\d:\d\d$/.test(A.resposta_data), 'status Fechada com nome e data', { s: A.status, d: A.resposta_data });
r = await call('/api/p/' + E.token, { semCookie: true }); ok(r.j.dados.status === 'Fechada' && r.j.dados.respostaData, 'página mostra proposta aprovada');
env.DB.db.prepare("UPDATE propostas SET status='Enviada',followup='15/10/2026',contato_whatsapp='11999998888',contato_nome='Carlos Lima' WHERE numero=?").run(P3.numero);
r = await call('/api/p/' + P3.token + '/resposta', { body: { acao: 'recusar', obs: 'Caro' }, semCookie: true }); ok(r.j.ok, 'recusa registrada');
r = await call('/api/p/' + P3.token, { semCookie: true }); ok(r.j.ok === false && /encerrada/.test(r.j.msg), 'página da recusada mostra mensagem de encerrada');

console.log('\n[6] Saídas para o n8n (avisos e follow-up)');
r = await call('/api/saidas', { semCookie: true }); ok(r.s === 401, 'saídas sem chave: 401');
setNow('2026-10-17T11:00:00Z');   // 08:00 em Brasília
env.DB.db.prepare("UPDATE propostas SET status='Enviada',followup='16/10/2026',followup_n=0,contato_whatsapp='5511977776666' WHERE numero=?").run(r.j ? P1.numero : P1.numero);
r = await call('/api/saidas?k=' + K, { semCookie: true }); const av = r.j.itens.filter(i => i.tipo === 'aviso'), fu = r.j.itens.filter(i => i.tipo === 'followup');
ok(av.length >= 5 && fu.length === 0, 'às 08:00: só avisos, nenhum follow-up (' + av.length + ' avisos)');
const ap = av.find(i => /APROVADA/.test(i.assunto)); ok(ap && ap.whatsapp === '5511900000000' && ap.email === 'equipe@x.com' && /Valor: R\$ 2\.120,00/.test(ap.texto) && /Maria Souza/.test(ap.texto), 'aviso de aprovação com valor, nome, whatsapp e e-mail da equipe', ap);
ok(av.some(i => /Novo briefing/.test(i.assunto)), 'aviso de novo briefing');
r = await call('/api/saidas_ok?k=' + K + '&tipo=aviso&ref=' + ap.ref, { semCookie: true }); ok(r.j.ok, 'aviso marcado como enviado');
r = await call('/api/saidas?k=' + K, { semCookie: true }); ok(!r.j.itens.some(i => i.ref === ap.ref && i.tipo === 'aviso'), 'aviso enviado não volta');
setNow('2026-10-17T13:00:00Z');   // 10:00 em Brasília
r = await call('/api/saidas?k=' + K, { semCookie: true }); const f2 = r.j.itens.filter(i => i.tipo === 'followup');
ok(f2.length === 1 && f2[0].ref === P1.numero && /Olá, Maria!/.test(f2[0].texto) && f2[0].texto.includes('https://propostas.exemplo.workers.dev/' + P1.token) && f2[0].tentativa === 1, 'às 10:00: follow-up com nome, link da proposta e tentativa 1', f2[0]);
r = await call('/api/saidas_ok?k=' + K + '&tipo=followup&ref=' + P1.numero, { semCookie: true }); ok(r.j.ok, 'follow-up marcado');
const fp = env.DB.db.prepare('SELECT followup,followup_n FROM propostas WHERE numero=?').get(P1.numero); ok(fp.followup_n === 1 && fp.followup === '20/10/2026', 'próximo follow-up em +3 dias (20/10/2026)', { ...fp });
r = await call('/api/saidas?k=' + K, { semCookie: true }); ok(!r.j.itens.some(i => i.tipo === 'followup'), 'follow-up não repete no mesmo dia');
globalThis.Date = RealDate;

console.log('\n[7] Catálogo, condições, config, usuários');
r = await call('/api/catalogo', { body: { itens: [] } }); ok(r.s === 400, 'catálogo vazio é recusado (protege contra apagar tudo)');
r = await call('/api/catalogo', { body: { itens: [{ servico: 'Captação', descricao: 'd', condicao: 'c', faixa1: 1000, faixa2: 1500, categoria: 'Vídeo' }, { servico: 'Drone', faixa1: 800, faixa2: 900 }] } }); r = await call('/api/dados'); ok(r.j.catalogo.length === 2 && r.j.catalogo[0].categoria === 'Vídeo' && r.j.catalogo[1].categoria === 'Serviços', 'catálogo salvo na ordem');
await call('/api/condicoes', { body: { itens: [{ titulo: 'Pagamento', texto: '30% entrada' }, { titulo: '', texto: 'x' }] } }); r = await call('/api/condicoes'); ok(r.j.itens.length === 1, 'condições salvas (linha sem título descartada)');
r = await call('/api/p/' + E.token, { semCookie: true }); ok(r.j.dados.condicoes.length === 1 && r.j.dados.condicoes[0][0] === 'Pagamento', 'condições aparecem na proposta');
r = await call('/api/usuario', { body: { login: 'socio', senha: 'outrasenha1' } }); ok(r.j.ok, 'segundo usuário criado');
r = await call('/api/usuario/remover', { body: { login: 'admin' } }); ok(r.s === 400, 'não deixa remover o próprio usuário');
const c1 = cookie; cookie = ''; await call('/api/login', { body: { login: 'socio', senha: 'outrasenha1' } }); const c2 = cookie; cookie = c1;
r = await call('/api/usuario', { body: { login: 'socio', senha: 'novasenha123' } }); cookie = c2; r = await call('/api/dados'); ok(r.s === 401, 'trocar a senha derruba as sessões antigas do usuário'); cookie = c1;
r = await call('/api/usuario/remover', { body: { login: 'socio' } }); ok(r.j.ok, 'usuário removido');
r = await call('/api/logout', { body: {} }); r = await call('/api/dados'); ok(r.s === 401, 'logout encerra a sessão'); cookie = ''; await call('/api/login', { body: { login: 'admin', senha: 'senha123456' } });

console.log('\n[8] Backup, restauração e importação da planilha antiga');
r = await call('/api/backup'); const B = JSON.parse(r.t); ok(r.h.get('Content-Disposition').includes('attachment') && B.propostas.length === 4 && B.itens.length === 1 && !('n8n_key' in B.config), 'backup baixa tudo, sem a chave secreta', { p: B.propostas.length });
const antes = (await call('/api/dados')).j.propostas.map(p => p.token + p.numero + p.status).sort().join();
env.DB.db.exec('DELETE FROM itens; DELETE FROM propostas; DELETE FROM catalogo;');
r = await call('/api/restaurar', { body: B }); ok(r.j.ok, 'restauração aceita');
const depois = (await call('/api/dados')).j.propostas.map(p => p.token + p.numero + p.status).sort().join(); ok(antes === depois, 'tokens, números e status idênticos após restaurar (links antigos continuam valendo)');
r = await call('/api/restaurar', { body: { qualquer: 1 } }); ok(r.s === 400, 'arquivo que não é backup é recusado');
r = await call('/api/importar', { body: { tabela: 'catalogo', linhas: [{ servico: 'Fotografia', descricao: 'x', condicao: 'y', faixa1: 'R$ 1.500,00', faixa2: '1.800,50', categoria: '' }] } }); r = await call('/api/dados');
ok(r.j.catalogo.length === 1 && r.j.catalogo[0].faixa1 === 1500 && r.j.catalogo[0].faixa2 === 1800.5, 'importa catálogo com preços no formato brasileiro (R$ 1.500,00)', r.j.catalogo);
r = await call('/api/importar', { body: { tabela: 'propostas', linhas: [{ numero: 'REC-2609-007', status: 'Enviada', cliente: 'ANTIGA', token: 'abc123def456', imposto_pct: '6', desconto_pct: '', faixa: '1', followup_n: '', contato_whatsapp: '11 91234-5678' }] } });
r = await call('/api/importar', { body: { tabela: 'itens', linhas: [{ numero: 'REC-2609-007', servico: 'Captação', qtd: '2', valor_unit: '1.000,00', valor: '2.000,00' }, { numero: 'REC-2609-007', servico: 'Edição', qtd: '1', valor_unit: '', valor: 'R$ 500,00' }] } });
r = await call('/api/dados'); const IM = r.j.propostas.find(p => p.numero === 'REC-2609-007'); ok(IM && IM.token === 'abc123def456' && IM.itens.length === 2 && IM.t.total === 2500 * 1.06 && IM.contato_whatsapp === '5511912345678', 'proposta antiga importada com o mesmo link (token), itens e total', IM && IM.t);
r = await call('/abc123def456', { semCookie: true }); ok(r.s === 200, 'o link antigo da proposta importada abre no sistema novo');
r = await call('/api/importar', { body: { tabela: 'config', linhas: [{ chave: 'n8n_key', valor: 'sequestro' }, { chave: 'banco', valor: 'Banco Z' }] } }); ok((await call('/api/chave', { body: {} })).j.chave !== 'sequestro' && (await call('/api/config')).j.config.banco === 'Banco Z', 'importar Config não consegue trocar a chave da automação');
r = await call('/api/importar', { body: { tabela: 'xxx', linhas: [] } }); ok(r.s === 400, 'tabela desconhecida recusada');


console.log('\n[10] Novidades: importação robusta, briefings em lote, mensagens, favicon, prefixo');
K = (await call('/api/config')).j.chave; r = await call('/api/config', { body: { prefixo: 'REC-2026' } }); ok(r.s === 400 && /sem hífen/.test(r.j.erro), 'prefixo com hífen/ano é recusado com explicação');
r = await call('/api/config', { body: { prefixo: 'REC' } }); ok(r.j.ok, 'prefixo REC aceito');
// token duplicado na importação (o erro que você viu)
const tokExistente = (await call('/api/dados')).j.propostas.find(p => p.numero === 'REC-2609-007').token;
r = await call('/api/importar', { body: { tabela: 'propostas', linhas: [
  { numero: 'REC-2608-010', status: 'Enviada', cliente: 'DUP A', token: 'tokdup0001' }, { numero: 'REC-2608-011', status: 'Enviada', cliente: 'DUP B', token: 'tokdup0001' },
  { numero: 'REC-2608-012', status: 'Enviada', cliente: 'COLIDE', token: tokExistente }, { numero: 'REC-2608-013', status: 'Enviada', cliente: 'SEM TOKEN', token: '' } ] } });
ok(r.j && r.j.ok && r.j.qtd === 4 && r.j.avisos.length === 2, 'tokens repetidos/colidindo não derrubam a importação: 2 ganham link novo e vêm avisados', r.j);
r = await call('/api/dados'); const toks = r.j.propostas.map(p => p.token); ok(new Set(toks).size === toks.length, 'nenhum token repetido no banco');
ok(r.j.propostas.find(p => p.numero === 'REC-2609-007').token === tokExistente, 'a proposta que já tinha o link mantém o link');
r = await call('/api/importar', { body: { tabela: 'propostas', linhas: [{ numero: 'REC-2608-010', status: 'Fechada', cliente: 'DUP A v2', token: 'tokdup0001' }] } }); ok(r.j.ok && r.j.avisos.length === 0, 'importar de novo a mesma proposta atualiza sem erro');
// briefings em lote (o JSON do mock, 2 briefings)
const m2 = [mock, { ...mock, id: 'OUTRO', respondentId: 'x', question_llRRWk: { label: 'Nome e Sobrenome', value: 'Ana Lima', type: 'INPUT_TEXT' }, question_OB00YR: { label: 'Organização', value: 'EMPRESA 2', type: 'INPUT_TEXT' } }];
const antesN = (await call('/api/dados')).j.propostas.length, avAntes = env.DB.db.prepare('SELECT COUNT(*) c FROM avisos').get().c;
r = await call('/api/importar', { body: { tabela: 'briefings', linhas: m2 } }); ok(r.j.ok && r.j.numeros.length === 2, 'importa 2 briefings do JSON', r.j);
const dp = (await call('/api/dados')).j.propostas; ok(dp.length === antesN + 1 || dp.length === antesN + 2, 'propostas criadas (o do mock que já existia não duplica)');
ok(dp.some(p => p.cliente === 'EMPRESA 2' && p.status === 'Briefing'), 'segundo briefing virou proposta com status Briefing');
ok(env.DB.db.prepare('SELECT COUNT(*) c FROM avisos').get().c === avAntes, 'importação de briefings não dispara avisos');
r = await call('/api/importar', { body: { tabela: 'briefings', linhas: m2 } }); ok(r.j.numeros.every(x => /já existia/.test(x)), 'importar os mesmos briefings de novo não duplica');
r = await call('/api/tally?k=' + K, { body: m2, semCookie: true }); ok(r.j.ok && r.j.resultados.length === 2, '/api/tally também aceita uma lista de briefings');
// mensagens
r = await call('/api/config'); ok(r.j.padroes.msg_followup1.includes('{projeto}') && r.j.padroes.msg_envio.includes('{validade_txt}'), 'modelos padrão disponíveis para o painel');
await call('/api/config', { body: { msg_followup1: 'Oi {nome}, PERSONALIZADA sobre {projeto} {link} *negrito*', texto_agradecimento: 'Texto novo de boas-vindas.', msg_duvida: 'Dúvida sobre {numero}: ' } });
env.DB.db.prepare("UPDATE propostas SET status='Enviada',followup='01/10/2026',followup_n=0,contato_nome='ana lima',contato_whatsapp='11955554444' WHERE cliente='EMPRESA 2'").run();
setNow('2026-10-20T14:00:00Z');
r = await call('/api/saidas?k=' + K, { semCookie: true }); const f9 = r.j.itens.find(i => i.tipo === 'followup' && /Oi Ana/.test(i.texto));
ok(f9 && f9.texto.includes('*negrito*') && f9.texto_email.includes('negrito') && !f9.texto_email.includes('*') && /^Sobre a proposta de /.test(f9.assunto), 'follow-up usa o modelo personalizado; no e-mail os asteriscos somem', f9);
globalThis.Date = RealDate;
const tkE2 = env.DB.db.prepare("SELECT token FROM propostas WHERE cliente='EMPRESA 2'").get().token;
r = await call('/api/p/' + tkE2, { semCookie: true }); ok(r.j.ok && r.j.dados.agradecimento === 'Texto novo de boas-vindas.' && /^Dúvida sobre REC-/.test(r.j.dados.msgDuvida), 'texto de boas-vindas e mensagem de dúvida vêm da configuração', r.j.dados && r.j.dados.msgDuvida);
env.DB.db.exec('UPDATE config SET valor=\'\' WHERE chave IN (\'msg_followup1\',\'msg_duvida\')');
r = await call('/api/p/' + tkE2, { semCookie: true }); ok(/^Olá! Estou vendo a proposta REC-/.test(r.j.dados.msgDuvida), 'modelo vazio volta ao padrão');
// confirmações ao cliente (desligadas por padrão)
const avA = env.DB.db.prepare('SELECT COUNT(*) c FROM avisos').get().c;
await call('/api/p/' + tkE2 + '/resposta', { body: { acao: 'aprovar', nome: 'Ana Lima' }, semCookie: true });
ok(env.DB.db.prepare('SELECT COUNT(*) c FROM avisos').get().c === avA + 1, 'aprovação com confirmação desligada: só o aviso da equipe');
env.DB.db.prepare("UPDATE propostas SET status='Enviada' WHERE cliente='EMPRESA 2'").run();
await call('/api/config', { body: { auto_aprovada: '1', auto_briefing: '1', prazo_proposta: 'ainda hoje' } });
await call('/api/p/' + tkE2 + '/resposta', { body: { acao: 'aprovar', nome: 'Ana Lima' }, semCookie: true });
let sx = (await call('/api/saidas?k=' + K, { semCookie: true })).j.itens; const cc = sx.find(i => /próximos passos/.test(i.assunto));
ok(cc && cc.whatsapp === '5511955554444' && /Olá, Ana!/.test(cc.texto) && /entrada de 30%/.test(cc.texto), 'confirmação de aprovação ao cliente (ligada): vai para o WhatsApp dele', cc);
r = await call('/api/tally?k=' + K, { body: tallyHook('R99'), semCookie: true }); sx = (await call('/api/saidas?k=' + K, { semCookie: true })).j.itens;
const cb = sx.find(i => /Recebemos o seu briefing/.test(i.assunto)); ok(cb && cb.whatsapp === '5511900000000' && /ainda hoje/.test(cb.texto) && /Maria/.test(cb.texto), 'confirmação de briefing recebido ao cliente, com o prazo configurado', cb);
// favicon
r = await W.fetch(new Request('https://x.dev/favicon.png'), env); const fb = new Uint8Array(await r.arrayBuffer()); ok(r.status === 200 && r.headers.get('Content-Type') === 'image/png' && fb[1] === 0x50, 'favicon.png é um PNG válido');
r = await W.fetch(new Request('https://x.dev/apple-touch-icon.png'), env); ok(r.status === 200, 'apple-touch-icon disponível');
r = await call('/painel', { semCookie: true }); ok(/rel="icon"/.test(r.t), 'painel referencia o favicon');
r = await call('/' + tkE2, { semCookie: true }); ok(/rel="icon"/.test(r.t), 'página da proposta referencia o favicon');


console.log('\n[11] Falha de envio não perde a mensagem');
await call('/api/config', { body: { aviso_whatsapp: '11900000000', aviso_email: 'equipe@x.com' } });
await call('/api/p/' + tkE2 + '/resposta', { body: { acao: 'recusar' }, semCookie: true });   // (já aprovada: não gera aviso novo)
env.DB.db.prepare("INSERT INTO avisos(assunto,texto,whatsapp,email) VALUES('TESTE FALHA','x','5511900000000','a@b.com')").run();
const idF = env.DB.db.prepare("SELECT id FROM avisos WHERE assunto='TESTE FALHA'").get().id;
for (let i = 1; i <= 3; i++) {
  const pend = (await call('/api/saidas?k=' + K, { semCookie: true })).j.itens.some(x => x.ref === String(idF) && x.tipo === 'aviso');
  ok(pend, 'tentativa ' + i + ': aviso ainda na fila');
  r = await call(`/api/saidas_ok?k=${K}&tipo=aviso&ref=${idF}&wa=0&em=0`, { semCookie: true }); ok(r.j.falhou === true, 'falha nos dois canais é registrada (' + i + ')');
}
ok(!(await call('/api/saidas?k=' + K, { semCookie: true })).j.itens.some(x => x.ref === String(idF) && x.tipo === 'aviso'), 'depois de 3 falhas desiste (não trava a fila)');
env.DB.db.prepare("INSERT INTO avisos(assunto,texto,whatsapp,email) VALUES('SO EMAIL','x','5511900000000','a@b.com')").run();
const idE = env.DB.db.prepare("SELECT id FROM avisos WHERE assunto='SO EMAIL'").get().id;
r = await call(`/api/saidas_ok?k=${K}&tipo=aviso&ref=${idE}&wa=0&em=1`, { semCookie: true }); ok(r.j.ok && !r.j.falhou, 'WhatsApp falhou mas e-mail funcionou: conta como enviado');
ok(!(await call('/api/saidas?k=' + K, { semCookie: true })).j.itens.some(x => x.ref === String(idE) && x.tipo === 'aviso'), 'e não volta para a fila');
env.DB.db.prepare("UPDATE propostas SET status='Enviada',followup='01/10/2026',followup_n=0,contato_whatsapp='5511955554444' WHERE cliente='EMPRESA 2'").run();
setNow('2026-10-21T14:00:00Z');
r = await call(`/api/saidas_ok?k=${K}&tipo=followup&ref=${dp.find(p => p.cliente === 'EMPRESA 2').numero}&wa=0&em=0`, { semCookie: true }); ok(r.j.falhou, 'follow-up que falhou nos dois canais não é marcado como feito');
ok((await call('/api/saidas?k=' + K, { semCookie: true })).j.itens.some(x => x.tipo === 'followup'), 'e continua pendente para a próxima rodada');
globalThis.Date = RealDate;


console.log('\n[12] Valores ruins já gravados, domínio próprio, iframe, aviso de teste, CSV do Tally, briefing do exemplo PDF');
// configuração "suja" como a do seu painel (prefixo REC202610 e imposto -17) + proposta antiga com imposto negativo
env.DB.db.exec("INSERT INTO config(chave,valor) VALUES('prefixo','REC202610') ON CONFLICT(chave) DO UPDATE SET valor='REC202610'; INSERT INTO config(chave,valor) VALUES('imposto_padrao','-17') ON CONFLICT(chave) DO UPDATE SET valor='-17'");
env.DB.db.prepare("INSERT INTO propostas(numero,token,imposto_pct,status) VALUES('LEGADO-1','legadotok00001',-17,'Rascunho')").run();
const W2 = (await import('./worker.mjs?fresh' + Math.random())).default;           // instância nova do Worker (simula reinício)
r = await W2.fetch(new Request('https://x.dev/api/estado'), env); await r.text();
ok(env.DB.db.prepare("SELECT imposto_pct v FROM propostas WHERE numero='LEGADO-1'").get().v === 6, 'proposta com imposto negativo é corrigida para 6% ao iniciar');
r = await call('/api/nova', { body: {} }); const nn2 = (await call('/api/dados')).j.propostas.find(p => p.numero === r.j.numero);
ok(/^REC-\d{4}-\d{3}$/.test(nn2.numero) && nn2.imposto_pct === 6, 'prefixo inválido gravado cai para REC e imposto -17 cai para 6%', { n: nn2.numero, i: nn2.imposto_pct }); await call('/api/excluir', { body: { numero: nn2.numero } });
r = await call('/api/config', { body: { imposto_padrao: '-17' } }); ok(r.s === 400 && /entre 0 e 100/.test(r.j.erro), 'imposto padrão negativo é recusado ao salvar');
r = await call('/api/config', { body: { imposto_padrao: 'abc' } }); ok(r.s === 400, 'imposto padrão não numérico é recusado');
r = await call('/api/config', { body: { imposto_padrao: '6', prefixo: 'REC' } }); ok(r.j.ok, 'valores corretos são aceitos e corrigem o que estava errado');
// endereço público
r = await call('/api/config', { body: { dominio_publico: 'proposta.recording.com.br/' } }); ok(r.s === 400, 'endereço público sem https é recusado');
r = await call('/api/config', { body: { dominio_publico: 'https://proposta.recording.com.br' } }); ok(r.j.ok, 'endereço público salvo');
r = await call('/api/dados'); ok(r.j.base === 'https://proposta.recording.com.br', 'painel passa a gerar links com o endereço público');
env.DB.db.prepare("UPDATE propostas SET status='Enviada',followup='01/10/2026',followup_n=0,contato_nome='Carla',contato_whatsapp='11922223333' WHERE numero=?").run(N1);
setNow('2026-10-22T14:00:00Z'); r = await call('/api/saidas?k=' + K, { semCookie: true }); globalThis.Date = RealDate;
const fl = r.j.itens.find(i => i.tipo === 'followup' && i.ref === N1); ok(fl && fl.texto.includes('https://proposta.recording.com.br/'), 'lembretes automáticos usam o endereço público', fl && fl.texto.slice(0, 160));
await call('/api/config', { body: { dominio_publico: '' } });
// iframe
r = await call('/painel', { semCookie: true }); ok(/frame-ancestors 'none'/.test(r.h.get('Content-Security-Policy')) && !r.h.get('X-Frame-Options'), 'por padrão o painel não pode ser incorporado');
r = await call('/api/config', { body: { incorporar_em: 'http://evil.com' } }); ok(r.s === 400, 'site autorizado precisa ser https');
r = await call('/api/config', { body: { incorporar_em: 'https://www.recording.com.br https://recording.com.br' } }); ok(r.j.ok, 'sites autorizados salvos');
r = await call('/painel', { semCookie: true }); ok(/frame-ancestors https:\/\/www\.recording\.com\.br https:\/\/recording\.com\.br/.test(r.h.get('Content-Security-Policy')) && !r.h.get('X-Frame-Options'), 'painel passa a aceitar iframe só dos sites autorizados');
await call('/api/config', { body: { incorporar_em: '' } });
// aviso de teste
await call('/api/config', { body: { aviso_whatsapp: '', aviso_email: '' } }); r = await call('/api/aviso_teste', { body: {} }); ok(r.s === 400, 'aviso de teste sem destino configurado: orientação clara');
await call('/api/config', { body: { aviso_whatsapp: '11 90000-0000', aviso_email: 'equipe@x.com' } }); r = await call('/api/aviso_teste', { body: {} }); ok(r.j.ok && r.j.whatsapp === '5511900000000', 'aviso de teste criado');
ok((await call('/api/saidas?k=' + K, { semCookie: true })).j.itens.some(i => i.assunto === 'Teste de aviso'), 'aviso de teste chega ao n8n');
// CSV exportado do Tally (uma linha = um briefing; opções em colunas TRUE/FALSE)
const rowCsv = { 'Submission ID': 'CSV001', 'Respondent ID': 'r1', 'Submitted at': '2026-10-18 10:00:00', 'Nome e Sobrenome': 'Paulo Reis', 'Email': 'paulo@loja.com', 'Telefone': '+55 11 97777-6666', 'Organização': 'LOJA DO PAULO', 'Quais produtos ou serviços serão abordados nesta ação?': 'Linha de produtos\nNova coleção', 'Quais os principais objetivos desta ação?': 'Divulgar a coleção',
  'Deseja incluir os seguintes serviços?': '', 'Deseja incluir os seguintes serviços? (Locução Masculina)': 'TRUE', 'Deseja incluir os seguintes serviços? (Locução Feminina)': 'FALSE', 'Deseja incluir os seguintes serviços? (Drone)': 'TRUE', 'O que achou deste Briefing?': '5', 'Feedback': 'ótimo' };
r = await call('/api/importar', { body: { tabela: 'briefings_csv', linhas: [rowCsv] } }); ok(r.j.ok && r.j.numeros.length === 1, 'CSV do Tally importado');
const pc = (await call('/api/dados')).j.propostas.find(p => p.cliente === 'LOJA DO PAULO');
ok(pc && pc.contato_whatsapp === '5511977776666' && pc.projeto === 'Linha de produtos · Nova coleção' && pc.status === 'Briefing', 'CSV: cliente, whatsapp e projeto (sem quebra de linha) corretos', pc && { p: pc.projeto, w: pc.contato_whatsapp });
ok(/Deseja incluir os seguintes serviços\?: Locução Masculina, Drone/.test(pc.briefing_texto) && !/Locução Feminina/.test(pc.briefing_texto) && !/Feedback|achou/.test(pc.briefing_texto), 'CSV: colunas TRUE/FALSE viram a lista de opções marcadas; nota/feedback ficam de fora');
r = await call('/api/importar', { body: { tabela: 'briefings_csv', linhas: [rowCsv] } }); ok(/já existia/.test(r.j.numeros[0]), 'CSV: o mesmo briefing (Submission ID) não duplica');
// briefing real da Empresa Exemplo Peças (extraído do PDF)
const hp = JSON.parse(fs.readFileSync('./examples/briefing_exemplo_webhook.json', 'utf8'));
r = await call('/api/importar', { body: { tabela: 'briefings', linhas: hp } }); ok(r.j.ok && r.j.numeros.length === 1, 'briefing da Empresa Exemplo Peças importado');
const ph = (await call('/api/dados')).j.propostas.find(p => p.cliente === 'Empresa Exemplo Peças');
ok(ph && ph.contato_nome === 'Fulano de Tal' && ph.contato_email === 'fulano@exemplo.com.br' && ph.contato_whatsapp === '5511900001111', 'Exemplo PDF: contato completo', ph && { n: ph.contato_nome, w: ph.contato_whatsapp });
ok(ph.projeto === 'Kit Exemplo A · Produto B · Projetos sob medida' && /Mostrar|vídeo padrão/.test(ph.objetivo), 'Exemplo PDF: título do projeto numa linha só e objetivo preenchido', ph.projeto);
ok(/Quais locais de veiculação do material produzido\?: Facebook, Instagram \/ TikTok, Youtube, Linked In/.test(ph.briefing_texto) && /A data ja foi definida\?: 09\/11\/2026/.test(ph.briefing_texto) && /Verba disponível para esta ação\.: 1000/.test(ph.briefing_texto), 'Exemplo PDF: veiculação, data (09/11/2026) e verba no briefing');


console.log('\n[13] Diagnóstico do teste ponta a ponta');
r = await call('/api/config'); ok(r.j.status.ultimo_poll && r.j.status.ultimo_tally, 'painel sabe quando o n8n consultou e quando o Tally entregou', { p: r.j.status.ultimo_poll, t: r.j.status.ultimo_tally });
ok(Array.isArray(r.j.status.avisos) && r.j.status.avisos.length > 0 && 'enviado' in r.j.status.avisos[0] && r.j.status.fila >= 0 && r.j.status.desistidos >= 0, 'fila de mensagens com a situação de cada uma');
r = await call('/api/backup'); ok(!('ultimo_poll' in JSON.parse(r.t).config), 'backup não leva os carimbos de diagnóstico');


console.log('\n[14] Migração, visualizações, prova do aceite, recuperar senha, backup automático, prévia do link');
// banco no formato ANTIGO (sem as colunas novas), como o que está na sua Cloudflare hoje
{
  const sqlAntigo = fs.readFileSync('./src/schema.sql', 'utf8').replace(/\s*visto_n INTEGER[^\n]*\n/, '\n');
  ok(!/visto_n/.test(sqlAntigo), 'preparou um schema antigo para o teste');
  const old = new D1(); old.db.exec(sqlAntigo); old.db.exec("INSERT INTO propostas(numero,token,cliente,status) VALUES('OLD-1','oldtoken00000001','ANTIGA','Enviada')");
  const W3 = (await import('./worker.mjs?old' + Math.random())).default;
  const rr = await W3.fetch(new Request('https://x.dev/api/estado'), { DB: old, CHAVE_INSTALACAO: 'x' }); await rr.text();
  const cols = old.db.prepare('PRAGMA table_info(propostas)').all().map(c => c.name);
  ok(['visto_n', 'visto_primeiro', 'visto_ultimo', 'resposta_meta'].every(c => cols.includes(c)), 'banco antigo ganha as colunas novas sozinho, sem perder dados');
  ok(old.db.prepare("SELECT cliente FROM propostas WHERE numero='OLD-1'").get().cliente === 'ANTIGA', 'dados antigos preservados');
}
// visualizações
const UAREAL = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1';
await call('/api/config', { body: { aviso_visualizacao: '1', aviso_whatsapp: '11900000000', aviso_email: 'equipe@x.com' } });
await call('/api/nova', { body: {} }); const nv = (await call('/api/dados')).j.propostas.at(-1);
await call('/api/proposta', { body: { numero: nv.numero, cliente: 'VISTA SA', projeto: 'Filme', status: 'Enviada', itens: [{ servico: 'x', qtd: 1, valor_unit: 100 }] } });
const tkV = nv.token, visto = () => env.DB.db.prepare('SELECT visto_n n FROM propostas WHERE token=?').get(tkV).n;
const avisosV = (num) => env.DB.db.prepare("SELECT COUNT(*) c FROM avisos WHERE assunto = ?").get('Proposta aberta · ' + (num || nv.numero)).c;
await call('/api/p/' + tkV, { semCookie: true, headers: { 'User-Agent': 'WhatsApp/2.23 A' } }); ok(visto() === 0, 'pré-visualização do WhatsApp não conta como abertura');
await call('/api/p/' + tkV, { semCookie: true, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1)' } }); ok(visto() === 0, 'robô não conta');
await call('/api/p/' + tkV + '?rev=1', { semCookie: true, headers: { 'User-Agent': UAREAL } }); ok(visto() === 0, 'prévia interna (rev=1) não conta');
await call('/api/p/' + tkV, { headers: { 'User-Agent': UAREAL } }); ok(visto() === 0, 'a equipe logada não conta');
await call('/api/p/' + tkV, { semCookie: true, headers: { 'User-Agent': UAREAL } }); ok(visto() === 1 && avisosV() === 1, 'cliente real abre: conta 1 e gera o aviso "abriu a proposta"');
await call('/api/p/' + tkV, { semCookie: true, headers: { 'User-Agent': UAREAL } }); ok(visto() === 1, 'recarregar em seguida não conta de novo');
setNow(new RealDate(Date.now() + 15 * 60000).toISOString()); await call('/api/p/' + tkV, { semCookie: true, headers: { 'User-Agent': UAREAL } }); globalThis.Date = RealDate;
ok(visto() === 2 && avisosV() === 1, 'abrir de novo depois de 15 min conta 2, mas só o primeiro gera aviso');
ok((await call('/api/dados')).j.propostas.find(p => p.token === tkV).visto_n === 2, 'painel recebe a contagem de aberturas');
const avTxt = env.DB.db.prepare("SELECT texto FROM avisos WHERE assunto = ?").get('Proposta aberta · ' + nv.numero).texto; ok(/VISTA SA abriu a proposta/.test(avTxt), 'texto do aviso diz quem abriu', avTxt);
// rascunho não conta
const rasc = (await call('/api/nova', { body: {} })).j.numero; const tkR = env.DB.db.prepare('SELECT token FROM propostas WHERE numero=?').get(rasc).token;
await call('/api/p/' + tkR, { semCookie: true, headers: { 'User-Agent': UAREAL } }); ok(env.DB.db.prepare('SELECT visto_n n FROM propostas WHERE token=?').get(tkR).n === 0, 'rascunho não conta aberturas');
// aviso desligável
await call('/api/config', { body: { aviso_visualizacao: '0' } });
await call('/api/nova', { body: {} }); const n2 = (await call('/api/dados')).j.propostas.at(-1); const n2num = n2.numero; await call('/api/proposta', { body: { numero: n2.numero, status: 'Enviada', cliente: 'SEM AVISO' } });
await call('/api/p/' + n2.token, { semCookie: true, headers: { 'User-Agent': UAREAL } }); ok(avisosV(n2num) === 0 && env.DB.db.prepare('SELECT visto_n n FROM propostas WHERE token=?').get(n2.token).n === 1, 'com o aviso desligado, conta mas não avisa');
// prova do aceite
r = await call('/api/p/' + n2.token + '/resposta', { semCookie: true, headers: { 'CF-Connecting-IP': '203.0.113.9', 'User-Agent': UAREAL }, body: { acao: 'aprovar', nome: 'Pessoa Aprovadora' } }); ok(r.j.ok, 'aprovação feita');
const meta = (await call('/api/dados')).j.propostas.find(p => p.token === n2.token).resposta_meta; ok(/^203\.0\.113\.9 · Mozilla/.test(meta), 'guarda IP e navegador de quem aprovou', meta);
ok(JSON.parse((await call('/api/backup')).t).propostas.find(p => p.token === n2.token).resposta_meta === meta, 'a prova do aceite entra no backup');
await call('/api/nova', { body: {} }); const n3 = (await call('/api/dados')).j.propostas.at(-1); await call('/api/proposta', { body: { numero: n3.numero, status: 'Enviada', cliente: 'DECLINA' } });
await call('/api/p/' + n3.token + '/resposta', { semCookie: true, body: { acao: 'recusar' } });
ok(env.DB.db.prepare("SELECT COUNT(*) c FROM avisos WHERE assunto = ?").get('Proposta declinada · ' + n3.numero + ' · DECLINA').c === 1, 'aviso interno usa a palavra "declinada"');
// recuperar senha
cookie = ''; r = await call('/api/recuperar', { body: { chave: 'errada', login: 'admin', senha: 'novasenha99' } }); ok(r.s === 403, 'recuperar com chave errada é recusado');
r = await call('/api/recuperar', { body: { chave: env.CHAVE_INSTALACAO, login: 'admin', senha: 'curta' } }); ok(r.s === 400, 'senha nova curta é recusada');
r = await call('/api/recuperar', { body: { chave: env.CHAVE_INSTALACAO, login: 'admin', senha: 'novasenha99' } }); ok(r.j.ok && cookie.startsWith('sid='), 'com a chave de instalação define senha nova e já entra');
r = await call('/api/dados'); ok(r.j.ok, 'sessão nova funciona');
cookie = ''; r = await call('/api/login', { body: { login: 'admin', senha: 'senha123456' } }); ok(r.s === 401, 'a senha antiga deixa de valer');
r = await call('/api/login', { body: { login: 'admin', senha: 'novasenha99' } }); ok(r.j.ok, 'a senha nova funciona');
for (let i = 0; i < 10; i++) await call('/api/recuperar', { body: { chave: 'x', login: 'admin', senha: 'novasenha99' }, semCookie: true });
r = await call('/api/recuperar', { body: { chave: env.CHAVE_INSTALACAO, login: 'admin', senha: 'novasenha99' }, semCookie: true }); ok(r.s === 429, 'recuperação também tem bloqueio contra tentativas em massa'); env.DB.db.exec('DELETE FROM falhas');
// backup automático
r = await call('/api/backup_auto', { semCookie: true }); ok(r.s === 401, 'backup automático sem chave: 401');
K = (await call('/api/config')).j.chave; r = await call('/api/backup_auto?k=' + K, { semCookie: true }); ok(r.s === 200 && /attachment/.test(r.h.get('Content-Disposition')) && JSON.parse(r.t).versao === 1 && !('n8n_key' in JSON.parse(r.t).config), 'backup automático com a chave devolve o arquivo, sem segredos');
// prévia do link
r = await call('/' + tkV, { semCookie: true, headers: { 'User-Agent': 'WhatsApp/2.23' } });
ok(/property="og:title" content="Proposta comercial · VISTA SA"/.test(r.t) && /property="og:image" content="https:\/\/propostas\.exemplo\.workers\.dev\/og\.png"/.test(r.t) && /summary_large_image/.test(r.t), 'link tem título e imagem de prévia (WhatsApp/Facebook)');
ok(!/<title>.*<title>/s.test(r.t) && /<title>Proposta REC-\d{4}-\d{3} - VISTA SA<\/title>/.test(r.t), 'título da aba continua certo');
r = await W.fetch(new Request('https://x.dev/og.png'), env); const ob = new Uint8Array(await r.arrayBuffer()); ok(r.status === 200 && ob[1] === 0x50 && ob.length > 20000, 'imagem de prévia disponível');


console.log('\n[15] Clientes, pagamento editável, 2 etapas, teste de endereço, segurança');
const { createHmac } = await import('node:crypto');
const b32d = s => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, val = 0; const out = []; for (const c of s) { const i = A.indexOf(c); if (i < 0) continue; val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } val &= (1 << bits) - 1; } return Buffer.from(out); };
const totp = (sec, off = 0) => { const c = Math.floor(Date.now() / 30000) + off, b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(c)); const h = createHmac('sha1', b32d(sec)).update(b).digest(), o = h[19] & 15, n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]; return String(n % 1000000).padStart(6, '0'); };
// segurança básica
r = await call('/painel', { semCookie: true }); ok(/max-age=31536000/.test(r.h.get('Strict-Transport-Security')), 'HSTS ativo (navegador só usa https)');
r = await call('/api/usuario', { body: { login: 'novo1', senha: 'abc123456' } }); ok(r.s === 400 && /10 caracteres/.test(r.j.erro), 'senha com menos de 10 caracteres é recusada');
// clientes
r = await call('/api/clientes', { body: { empresa: '' } }); ok(r.s === 400, 'cliente sem nome da empresa é recusado');
r = await call('/api/clientes', { body: { empresa: 'ACME Ltda', cnpj: '11.222.333/0001-44', contato_nome: 'Ana Lima', contato_email: 'ana@acme.com', contato_whatsapp: '11 91111-2222' } }); const idAcme = r.j.id; ok(r.j.ok && idAcme > 0, 'cliente cadastrado');
r = await call('/api/clientes'); const acme = r.j.itens.find(c => c.id === idAcme); ok(acme && acme.contato_whatsapp === '5511911112222' && acme.n_propostas === 0, 'whatsapp normalizado e contador de propostas');
r = await call('/api/nova', { body: { cliente_id: idAcme } }); const pn = (await call('/api/dados')).j.propostas.find(p => p.numero === r.j.numero);
ok(pn.cliente === 'ACME Ltda' && pn.contato_nome === 'Ana Lima' && pn.contato_whatsapp === '5511911112222' && pn.contato_email === 'ana@acme.com' && pn.cliente_id === idAcme, 'nova proposta a partir do cliente já vem preenchida');
r = await call('/api/tally?k=' + K, { body: tallyHook('ACMEBRIEF', { }), semCookie: true });
const hookAcme = tallyHook('ACMEBRIEF2'); hookAcme.data.fields.find(f => f.label === 'Organização').value = 'acme LTDA'; hookAcme.data.fields.find(f => f.label === 'Email').value = 'outro@acme.com';
r = await call('/api/tally?k=' + K, { body: hookAcme, semCookie: true }); const pAcme = (await call('/api/dados')).j.propostas.find(p => p.numero === r.j.numero);
ok(pAcme.cliente_id === idAcme, 'briefing da mesma empresa (maiúsculas diferentes) é ligado ao cliente existente');
const nCli = (await call('/api/clientes')).j.itens.length;
const hookNovo = tallyHook('NOVOCLI'); hookNovo.data.fields.find(f => f.label === 'Organização').value = 'EMPRESA NOVA SA'; hookNovo.data.fields.find(f => f.label === 'Email').value = 'contato@nova.com';
r = await call('/api/tally?k=' + K, { body: hookNovo, semCookie: true });
const cli2 = (await call('/api/clientes')).j.itens; ok(cli2.length === nCli + 1 && cli2.some(c => c.empresa === 'EMPRESA NOVA SA' && c.contato_email === 'contato@nova.com'), 'briefing de empresa nova cadastra o cliente sozinho');
// importação (HubSpot em português e em inglês)
r = await call('/api/importar', { body: { tabela: 'clientes', linhas: [
  { 'record id - company': '5501', 'nome da empresa': 'Gama Peças Ltda', 'nome do domínio da empresa': 'gama.com.br', 'número de telefone': '11 90000-1111', 'cidade': 'São Paulo' },
  { 'nome': 'Paula', 'sobrenome': 'Souza', 'e-mail': 'paula@gama.com.br', 'nome da empresa': 'Gama Peças Ltda' },
  { 'name': 'Beta Corp', 'company domain name': 'beta.com', 'phone number': '+55 11 98888-7777', 'city': 'Campinas' },
  { 'nome da empresa': 'ACME LTDA', 'cnpj': '99' }, { 'nome da empresa': 'Empresa Nova SA', 'website': 'nova.com.br' }, { 'cidade': 'sem nome' } ] } });
ok(r.j.ok && r.j.criados === 2 && r.j.mesclados === 1 && r.j.atualizados === 1 && r.j.ignorados === 2, 'HubSpot: 2 novos (Gama, Beta), contato da Gama mesclado, 1 existente completado, 2 ignorados', r.j);
const cl3 = (await call('/api/clientes')).j.itens; const hp2 = cl3.find(c => c.empresa === 'Gama Peças Ltda'), bt = cl3.find(c => c.empresa === 'Beta Corp');
ok(hp2 && hp2.hubspot_id === '5501' && hp2.site === 'gama.com.br' && hp2.contato_whatsapp === '5511900001111', 'HubSpot PT: id, site e telefone importados', hp2);
ok(bt && bt.site === 'beta.com' && bt.cidade === 'Campinas' && bt.contato_whatsapp === '5511988887777', 'HubSpot EN: Name / Company Domain Name / Phone Number reconhecidos', bt);
ok(cl3.find(c => c.id === idAcme).cnpj === '11.222.333/0001-44' && cl3.find(c => c.empresa === 'EMPRESA NOVA SA').site === 'nova.com.br', 'importar completa o que está vazio e não sobrescreve o que já existe');
ok(hp2.contato_nome === 'Paula Souza' && hp2.contato_email === 'paula@gama.com.br' && cl3.filter(c => /Gama/.test(c.empresa)).length === 1, 'contato e empresa do HubSpot viram um cadastro só');
// backup e restauração preservam clientes e vínculos
const bk2 = JSON.parse((await call('/api/backup')).t); ok(bk2.clientes.length === cl3.length && bk2.propostas.some(p => p.cliente_id === idAcme), 'backup leva clientes e o vínculo das propostas');
await call('/api/restaurar', { body: bk2 }); const dep = await call('/api/dados'); ok(dep.j.clientes.length === cl3.length && dep.j.propostas.find(p => p.numero === pn.numero).cliente_id === idAcme, 'restauração devolve clientes e vínculos');
r = await call('/api/clientes/remover', { body: { id: idAcme } }); const dep2 = await call('/api/dados'); ok(!dep2.j.clientes.some(c => c.id === idAcme) && dep2.j.propostas.find(p => p.numero === pn.numero).cliente_id === null && dep2.j.propostas.find(p => p.numero === pn.numero).cliente === 'ACME Ltda', 'excluir cliente mantém a proposta (só desliga o vínculo)');
// pagamento
await call('/api/config', { body: { pag_entrada_padrao: '', pag_entrada_txt_padrao: '', pag_resto_txt_padrao: '', pag_formas_padrao: '', pag_obs_padrao: '' } });
r = await call('/api/nova', { body: {} }); let pg2 = (await call('/api/dados')).j.propostas.find(p => p.numero === r.j.numero);
ok(pg2.pag_entrada === 30 && pg2.pag_entrada_txt === 'na aprovação da proposta' && pg2.pag_resto_txt === '30 dias após a aprovação' && /TED\/Pix/.test(pg2.pag_formas), 'proposta nova vem com o pagamento padrão (sinal 30% + restante em 30 dias)');
r = await call('/api/config', { body: { pag_entrada_padrao: '150' } }); ok(r.s === 400, 'sinal padrão acima de 100 é recusado');
await call('/api/config', { body: { pag_entrada_padrao: '50', pag_resto_txt_padrao: 'na entrega do material', pag_formas_padrao: 'Pix\nBoleto' } });
r = await call('/api/nova', { body: {} }); const pg3 = (await call('/api/dados')).j.propostas.find(p => p.numero === r.j.numero); ok(pg3.pag_entrada === 50 && pg3.pag_resto_txt === 'na entrega do material' && pg3.pag_formas === 'Pix\nBoleto', 'padrão de pagamento editável vale para as próximas propostas');
await call('/api/proposta', { body: { numero: pg3.numero, status: 'Enviada', cliente: 'PAG TESTE', pag_entrada: 40, pag_entrada_txt: 'em 3 dias', pag_resto_txt: '30 dias depois', pag_formas: 'Pix\nCartão', pag_obs: 'Obs X', itens: [{ servico: 'x', qtd: 1, valor_unit: 1000 }] } });
const pubp = (await call('/api/p/' + pg3.token, { semCookie: true, headers: { 'User-Agent': UAREAL } })).j.dados;
ok(pubp.pag2 && pubp.pag2.entrada === 40 && pubp.pag2.entradaTxt === 'em 3 dias' && pubp.pag2.restoTxt === '30 dias depois' && pubp.pag2.formas.join() === 'Pix,Cartão' && pubp.pag2.obs === 'Obs X', 'proposta pública recebe o pagamento configurado');
await call('/api/proposta', { body: { numero: pg3.numero, pag_entrada: 250 } }); ok((await call('/api/dados')).j.propostas.find(p => p.numero === pg3.numero).pag_entrada === 100, 'sinal acima de 100 é limitado a 100');
await call('/api/proposta', { body: { numero: pg3.numero, pag_entrada: '' } }); ok((await call('/api/dados')).j.propostas.find(p => p.numero === pg3.numero).pag_entrada === -1, 'sinal em branco volta ao texto antigo (-1)');
ok(!(await call('/api/p/' + pg3.token, { semCookie: true, headers: { 'User-Agent': UAREAL } })).j.dados.pag2, 'sem sinal definido, a proposta usa o bloco antigo (sem pag2)');
// verificação em duas etapas
r = await call('/api/2fa/ativar', { body: { codigo: '123456' } }); ok(r.s === 400, 'ativar sem ter iniciado é recusado');
r = await call('/api/2fa/iniciar', { body: {} }); const seg = r.j.segredo; ok(/^[A-Z2-7]{32}$/.test(seg) && /^otpauth:\/\/totp\//.test(r.j.uri), 'inicia a 2ª etapa: chave de 32 caracteres e endereço otpauth');
r = await call('/api/2fa/ativar', { body: { codigo: '000000' } }); ok(r.s === 400, 'código errado não liga');
r = await call('/api/2fa/ativar', { body: { codigo: totp(seg) } }); ok(r.j.ok, 'código certo liga a 2ª etapa');
ok((await call('/api/config')).j.usuarios.find(u => u.login === 'admin').dois === 1, 'lista de usuários mostra 2 etapas ligada');
cookie = ''; r = await call('/api/login', { body: { login: 'admin', senha: 'novasenha99' } }); ok(r.s === 401 && r.j.precisa2fa === true && !cookie, 'login só com senha agora pede o código');
r = await call('/api/login', { body: { login: 'admin', senha: 'novasenha99', codigo: '111111' } }); ok(r.s === 401 && !r.j.precisa2fa && !cookie, 'código errado: recusado');
r = await call('/api/login', { body: { login: 'admin', senha: 'novasenha99', codigo: totp(seg) } }); ok(r.j.ok && cookie.startsWith('sid='), 'senha + código certo: entra');
r = await call('/api/login', { body: { login: 'admin', senha: 'errada12345', codigo: totp(seg) }, semCookie: true }); ok(r.s === 401, 'código certo não salva senha errada');
const c2fa = cookie; cookie = ''; await call('/api/login', { body: { login: 'admin', senha: 'novasenha99', codigo: totp(seg) } }); const outra = cookie; cookie = c2fa;
r = await call('/api/sessoes/encerrar', { body: {} }); const mine = await call('/api/dados'); cookie = outra; const other = await call('/api/dados'); cookie = c2fa;
ok(r.j.ok && mine.j.ok && other.s === 401, 'encerrar sessões derruba as outras e mantém a atual');
r = await call('/api/2fa/desativar', { body: { senha: 'errada12345' } }); ok(r.s === 403, 'desligar a 2ª etapa exige a senha');
r = await call('/api/2fa/desativar', { body: { senha: 'novasenha99' } }); ok(r.j.ok, '2ª etapa desligada');
cookie = ''; r = await call('/api/login', { body: { login: 'admin', senha: 'novasenha99' } }); ok(r.j.ok, 'sem 2ª etapa, entra só com a senha');
// recuperar acesso também limpa a 2ª etapa (celular perdido)
const s2 = (await call('/api/2fa/iniciar', { body: {} })).j.segredo; await call('/api/2fa/ativar', { body: { codigo: totp(s2) } });
cookie = ''; r = await call('/api/recuperar', { body: { chave: env.CHAVE_INSTALACAO, login: 'admin', senha: 'novasenha99' } }); ok(r.j.ok, 'recuperar acesso com a chave de instalação');
cookie = ''; r = await call('/api/login', { body: { login: 'admin', senha: 'novasenha99' } }); ok(r.j.ok, 'depois de recuperar, a 2ª etapa fica desligada (entra só com a senha)');
// teste de endereço (DNS)
const fetchReal = globalThis.fetch;
globalThis.fetch = async () => ({ json: async () => ({ Status: 3 }) }); r = await call('/api/testar_dominio', { body: { dominio: 'https://prospostas.recording.com.br' } });
ok(r.j.verificado === true && r.j.existe === false && r.j.host === 'prospostas.recording.com.br', 'endereço com erro de digitação (NXDOMAIN) é detectado');
globalThis.fetch = async () => ({ json: async () => ({ Status: 0, Answer: [{ data: '1.2.3.4' }] }) }); r = await call('/api/testar_dominio', { body: { dominio: 'https://propostas.recording.com.br' } }); ok(r.j.existe === true, 'endereço que existe é aceito');
globalThis.fetch = async () => { throw new Error('rede'); }; r = await call('/api/testar_dominio', { body: { dominio: 'https://propostas.recording.com.br' } }); ok(r.j.ok && r.j.verificado === false, 'se a consulta DNS falhar, não bloqueia nada');
globalThis.fetch = fetchReal; r = await call('/api/testar_dominio', { body: { dominio: 'sem-https' } }); ok(r.s === 400, 'endereço inválido é recusado');


console.log('\n[16] Segurança: HTML vindo do formulário público não pode virar código na página');
const xss = '<img src=x onerror=alert(1)><script>alert(2)</script>"&\'';
const hx = tallyHook('XSS1'); hx.data.fields.find(f => f.label === 'Organização').value = 'A&B ' + xss; hx.data.fields.find(f => f.label === 'Quais os principais objetivos desta ação?').value = xss;
hx.data.fields.find(f => f.label === 'Quais produtos ou serviços serão abordados nesta ação?').value = xss;
r = await call('/api/tally?k=' + K, { body: hx, semCookie: true }); const xnum = r.j.numero; const xp = (await call('/api/dados')).j.propostas.find(p => p.numero === xnum);
await call('/api/proposta', { body: { numero: xnum, status: 'Enviada', entregas: xss + ' | ' + xss, itens: [{ servico: xss, descricao: xss, qtd: 1, valor_unit: 10 }] } });
r = await call('/api/p/' + xp.token, { semCookie: true, headers: { 'User-Agent': UAREAL } }); const dj = JSON.stringify({ ...r.j.dados, msgDuvida: '' });   // msgDuvida é texto puro, usado só dentro de encodeURIComponent
ok(r.j.ok && !/<img|<script/i.test(dj) && /&lt;img src=x onerror=alert\(1\)&gt;/.test(dj), 'tudo que veio do briefing/itens chega ESCAPADO (sem <img> nem <script>)', dj.slice(0, 200));
ok(r.j.dados.cliente.startsWith('A&amp;B '), 'o "&" é escapado uma vez só (A&amp;B)');
ok(/&quot;/.test(dj), 'aspas duplas escapadas');
r = await call('/' + xp.token, { semCookie: true, headers: { 'User-Agent': UAREAL } }); ok(!/<img src=x/.test(r.t.split('const BASE')[0]) && !/<title>[^<]*<img/.test(r.t), 'a página HTML (título e meta) também não deixa passar tag');

console.log('\n[17] Duplicar proposta');
r = await call('/api/nova', { body: {} }); const dn = r.j.numero;
await call('/api/proposta', { body: { numero: dn, status: 'Enviada', cliente: 'DUP SA', projeto: 'Filme', contato_nome: 'Ana', contato_whatsapp: '11911112222', followup: '01/10/2026', imposto_pct: 8, desconto_pct: 10, pag_entrada: 40, pag_resto_txt: 'em 45 dias', itens: [{ servico: 'A', qtd: 2, valor_unit: 500 }, { servico: 'B', qtd: 1, valor_unit: 250 }] } });
env.DB.db.prepare("UPDATE propostas SET resposta_data='01/10/2026 10:00',resposta_nome='X',visto_n=3,followup_n=2,data_envio='01/10/2026' WHERE numero=?").run(dn);
r = await call('/api/duplicar', { body: { numero: dn } }); ok(r.j.ok && r.j.numero && r.j.numero !== dn, 'duplicar cria uma proposta nova', r.j);
const dd2 = (await call('/api/dados')).j.propostas, orig = dd2.find(p => p.numero === dn), cp = dd2.find(p => p.numero === r.j.numero);
ok(cp && cp.status === 'Rascunho' && cp.token !== orig.token && cp.cliente === 'DUP SA' && cp.projeto === 'Filme' && cp.contato_whatsapp === '5511911112222' && cp.imposto_pct === 8 && cp.desconto_pct === 10 && cp.pag_entrada === 40 && cp.pag_resto_txt === 'em 45 dias', 'a cópia leva os dados, fica em Rascunho e ganha link novo', cp);
ok(cp.itens.length === 2 && cp.t.total === orig.t.total, 'a cópia leva os itens e o mesmo total', cp.t);
ok(cp.resposta_data === '' && cp.resposta_nome === '' && cp.visto_n === 0 && cp.followup_n === 0 && cp.followup === '' && cp.data_envio === '', 'a cópia não herda resposta do cliente, aberturas nem follow-up', cp);
ok(orig.status === 'Enviada' && orig.resposta_nome === 'X' && orig.itens.length === 2, 'a proposta original continua intacta');
r = await call('/api/duplicar', { body: { numero: 'NAO-EXISTE' } }); ok(r.s === 404, 'duplicar proposta que não existe: 404');
r = await call('/api/duplicar', { body: { numero: dn }, headers: { 'Sec-Fetch-Site': 'cross-site' } }); ok(r.s === 403, 'duplicar a partir de outro site (CSRF) é recusado');
r = await call('/api/duplicar', { body: { numero: dn }, semCookie: true }); ok(r.s === 401, 'duplicar sem login é recusado');

console.log('\n[9] Banco não ligado / raiz');
r = await W.fetch(new Request('https://x.dev/painel'), {}); ok(r.status === 500 && /D1/.test(await r.text()), 'sem banco ligado: mensagem explicando o que fazer');
r = await W.fetch(new Request('https://x.dev/'), env); ok(r.status === 302 && r.headers.get('Location') === 'https://x.dev/painel', '/ redireciona para /painel');
console.log(`\n${n - falhas}/${n} verificações passaram${falhas ? ' — ' + falhas + ' FALHARAM' : ''}`); process.exit(falhas ? 1 : 0);
