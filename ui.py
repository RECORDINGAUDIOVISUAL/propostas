import json,urllib.request,glob,subprocess,time,os
srv=subprocess.Popen(['node','--no-warnings','serve.mjs'],stdout=open('serve.log','w'),stderr=subprocess.STDOUT)
time.sleep(2)
from playwright.sync_api import sync_playwright
B='http://localhost:8799'
def hook(k,rid):
    d={"eventId":"e"+rid,"data":{"responseId":rid,"fields":[
     {"key":"a","label":"Nome e Sobrenome","type":"INPUT_TEXT","value":"Maria Souza"},{"key":"b","label":"Email","type":"INPUT_EMAIL","value":"maria@rex.com"},
     {"key":"c","label":"Telefone","type":"INPUT_PHONE_NUMBER","value":"+5511900000000"},{"key":"d","label":"Organização","type":"INPUT_TEXT","value":"REX RECICLAGEM"},
     {"key":"e","label":"Quais produtos ou serviços serão abordados nesta ação?","type":"TEXTAREA","value":"Rodapé de proteção"},
     {"key":"f","label":"Quais os principais objetivos desta ação?","type":"TEXTAREA","value":"Mostrar o produto"}]}}
    r=urllib.request.Request(B+'/api/tally?k='+k,json.dumps(d).encode(),{'Content-Type':'application/json'}); return json.load(urllib.request.urlopen(r))
errs=[]
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':1280,'height':900}); pg=ctx.new_page(); dlg=[]; pg.on('dialog',lambda d:dlg.append(d.message))
    pg.on('pageerror',lambda e:errs.append(str(e))); pg.on('dialog',lambda d:d.accept())
    pg.goto(B+'/painel'); pg.wait_for_selector('#f-setup:not([hidden])'); print('1 primeiro acesso aparece:',pg.inner_text('#lt'))
    pg.fill('#sk','chave-errada'); pg.fill('#lg','admin'); pg.fill('#pin','senha123456'); pg.click('#bentrar'); pg.wait_for_selector('#err:has-text("incorreta")'); print('2 chave errada ->',pg.inner_text('#err'))
    pg.fill('#sk','teste-instalacao'); pg.click('#bentrar'); pg.wait_for_selector('#app:not([hidden])'); print('3 entrou no painel; menu:',[x.inner_text() for x in pg.locator('#nav button').all()])
    # importar da planilha antiga
    pg.click('[data-v=backup]'); pg.set_input_files('#imp',sorted(glob.glob('examples/csv/*.csv'))); pg.wait_for_selector('#impgo'); print('4 reconheceu:',pg.inner_text('#impr').replace('\n',' | ')[:230])
    pg.click('#impgo'); pg.wait_for_selector('#impr:has-text("Importado")'); print('5',pg.inner_text('#impr').replace('\n',' | '))
    pg.click('[data-v=catalogo]'); pg.wait_for_selector('[data-ci]'); print('6 catálogo:',pg.locator('[data-ci][data-f=servico]').evaluate_all('e=>e.map(x=>x.value)'),pg.locator('[data-f=faixa1]').evaluate_all('e=>e.map(x=>x.value)'))
    pg.fill('[data-ci="2"][data-f=faixa1]','1300'); pg.click('#catadd'); pg.fill('[data-ci="3"][data-f=servico]','Drone'); pg.fill('[data-ci="3"][data-f=faixa1]','900'); pg.click('#catsave'); pg.wait_for_selector('#toast:not([hidden])'); print('7 toast:',pg.inner_text('#toast'))
    pg.screenshot(path='shot_catalogo.png')
    pg.click('[data-v=condicoes]'); pg.wait_for_selector('[data-di]'); print('8 condições:',pg.locator('[data-di][data-f=titulo]').evaluate_all('e=>e.map(x=>x.value)'))
    pg.click('[data-v=empresa]'); pg.wait_for_selector('[data-cf=empresa_nome]'); pg.fill('[data-cf=empresa_nome]','Minha Produtora'); pg.fill('[data-cf=aviso_whatsapp]','11 90000-0000'); pg.fill('[data-cf=aviso_email]','equipe@x.com'); print('9 banco importado:',repr(pg.input_value('[data-cf=banco]'))); pg.click('#cfsave'); pg.wait_for_selector('#tn:has-text("Minha Produtora")'); print('  nome no topo:',pg.inner_text('#tn'))
    pg.screenshot(path='shot_empresa.png')
    pg.click('[data-v=automacao]'); pg.wait_for_selector('#newkey'); pg.click('#newkey'); pg.wait_for_selector('input[readonly]'); K=pg.locator('input[readonly]').first.input_value(); print('10 chave gerada:',len(K),'caracteres | webhook:',pg.locator('input[readonly]').nth(1).input_value()[:60]+'…')
    pg.screenshot(path='shot_automacao.png')
    print('11 Tally ->',hook(K,'T1'))
    pg.click('[data-v=prop]'); pg.click('text=Atualizar'); pg.wait_for_selector('#tab tr.l'); print('12 lista:',pg.locator('#tab tr.l').first.inner_text().replace('\t',' | ').replace('\n',' '))
    pg.locator('#tab tr.l td').first.click(); pg.wait_for_selector('#md .g2')
    pg.click('text=+ Item'); pg.select_option('#I select[data-f=servico]','Captação diária'); print('13 item do catálogo -> valor unitário:',pg.input_value('#I input[data-f=valor_unit]'),'| total:',pg.inner_text('#T').replace('\n',' '))
    pg.fill('[data-k=followup]','20/10/2026'); pg.screenshot(path='shot_editor.png')
    pg.evaluate("enviar()"); pg.wait_for_selector('#msg'); msg=pg.input_value('#msg'); print('14 mensagem pronta:',msg.split('\n')[0][:120])
    import re; link=re.search(r'https?://\S+',msg).group(0); print('   link do cliente:',link)
    # cliente abre e aprova
    cl=ctx.new_page(); cl.on('pageerror',lambda e:errs.append(str(e))); cl.goto(link); cl.wait_for_selector('[data-ac=aprovar]'); print('15 cliente vê a proposta; título:',cl.title(),'| empresa:',cl.locator('footer, .ft, body').first.inner_text().count('Minha Produtora')>0)
    cl.screenshot(path='shot_cliente.png')
    cl.locator('#investimento [data-ac=aprovar]').click(); cl.fill('#rn','Maria Souza'); cl.check('#rc'); cl.fill('#ro','Pode começar'); cl.click('#rok'); cl.wait_for_selector('#investimento .resp'); print('16 cliente aprovou ->',cl.inner_text('#investimento .cta2')[:80])
    pg.keyboard.press('Escape'); pg.evaluate("fechar()"); pg.click('text=Atualizar'); pg.wait_for_timeout(400)
    print('17 painel: KPI',pg.inner_text('#kpis .kpi:nth-child(3)').replace('\n',' '),'| status na lista:',pg.locator('#tab tr.l').first.inner_text().replace('\t',' | ').replace('\n',' ')[:100])
    pg.screenshot(path='shot_painel.png')
    pg.locator('#tab tr.l td').first.click(); pg.wait_for_selector('#md .c'); print('18 editor mostra:',pg.inner_text('#md .c').replace('\n',' ')[:120])
    # avisos pelo n8n
    r=json.load(urllib.request.urlopen(B+'/api/saidas?k='+K)); print('19 avisos pendentes para o n8n:',[ (i['assunto'][:45],i['whatsapp'],i['email']) for i in r['itens']])
    # sair / entrar
    pg.evaluate("fechar()"); pg.click('text=Sair'); pg.wait_for_selector('#login:not([hidden])'); pg.fill('#lg','admin'); pg.fill('#pin','senha123456'); pg.click('#bentrar'); pg.wait_for_selector('#app:not([hidden])'); print('20 sair e entrar de novo: ok')
    pg.reload(); pg.wait_for_selector('#app:not([hidden])'); print('21 recarregar a página mantém a sessão: ok')

    # ---- novidades
    print('22 favicon no painel:',pg.evaluate("document.querySelector('link[rel=icon]').href"))
    pg.click('[data-v=mensagens]'); pg.wait_for_selector('#pv_msg_envio'); print('23 prévia da mensagem de envio:\n   '+pg.inner_text('#pv_msg_envio').replace('\n','\n   ')[:420])
    pg.fill('[data-cf=msg_followup1]','Oi {nome}, sobre {projeto}: {link}'); print('24 prévia ao digitar:',pg.inner_text('#pv_msg_followup1')[:90])
    pg.check('[data-cf=auto_aprovada]'); pg.click('#mgsave'); pg.wait_for_selector('#toast:has-text("Mensagens salvas")'); print('25 mensagens salvas')
    pg.screenshot(path='shot_mensagens.png',full_page=True)
    pg.click('[data-v=backup]'); import os; os.makedirs('tmpj',exist_ok=True)
    mock=json.load(open('examples/mock_briefing_tally_node.json')); mock2=dict(mock[0]); mock2['id']='B2'; mock2['question_OB00YR']={'label':'Organização','value':'SEGUNDA EMPRESA','type':'INPUT_TEXT'}
    json.dump([mock[0],mock2],open('tmpj/briefings.json','w'))
    # caixa única: JSON do Tally + CSV do Tally + backup do sistema, tudo junto, sem escolher o tipo
    open('tmpj/tally.csv','w',encoding='utf-8').write('Submission ID,Respondent ID,Submitted at,Nome e Sobrenome,Email,Telefone,Organização,Quais produtos ou serviços serão abordados nesta ação?,Deseja incluir os seguintes serviços?,Deseja incluir os seguintes serviços? (Drone),Deseja incluir os seguintes serviços? (Locução Feminina)\nCSVX1,r1,2026-10-18,Paulo Reis,paulo@loja.com,+55 11 97777-6666,LOJA DO PAULO,"Linha de produtos\nNova coleção",,TRUE,FALSE\n')
    bk=ctx.request.get(B+'/api/backup'); open('tmpj/backup.json','wb').write(bk.body())
    import shutil; shutil.copy('examples/briefing_exemplo_webhook.json','tmpj/briefing-henry.json')
    pg.set_input_files('#imp',['tmpj/briefings.json','tmpj/tally.csv','tmpj/briefing-henry.json','tmpj/backup.json']); pg.wait_for_selector('#impgo')
    print('26 reconheceu sozinho:\n   '+pg.inner_text('#impr').replace('\n','\n   '))
    pg.click('#impgo'); pg.wait_for_selector('#impr:has-text("Importado")'); print('   resultado:',pg.inner_text('#impr').replace('\n',' | ')[:300])
    pg.click('[data-v=prop]'); pg.click('text=Atualizar'); pg.wait_for_selector('#tab tr.l'); print('27 lista agora tem',pg.locator('#tab tr.l').count(),'propostas; clientes:',pg.locator('#tab tr.l td:nth-child(2)').all_inner_texts())
    pg.click('[data-v=empresa]'); pg.wait_for_selector('[data-cf=prefixo]'); pg.fill('[data-cf=prefixo]','REC-2026'); pg.click('#cfsave'); pg.wait_for_selector('#toast:has-text("sem hífen")'); print('28 prefixo errado ->',pg.inner_text('#toast')[:110])

    pg.click('[data-v=empresa]'); pg.wait_for_selector('[data-cf=dominio_publico]'); print('29 campos novos na aba Empresa: endereço público, iframe, teste:',pg.locator('[data-cf=dominio_publico]').count(),pg.locator('[data-cf=incorporar_em]').count(),pg.locator('#avteste').count())
    pg.fill('[data-cf=prefixo]','REC'); pg.fill('[data-cf=imposto_padrao]','-17'); pg.click('#cfsave'); pg.wait_for_selector('#toast:has-text("entre 0 e 100")'); print('30 imposto -17 ->',pg.inner_text('#toast')[:80])
    pg.fill('[data-cf=imposto_padrao]','6'); pg.fill('[data-cf=aviso_whatsapp]','11 90000-0000'); pg.click('#cfsave'); pg.wait_for_selector('#toast:has-text("Salvo")'); pg.click('#avteste'); pg.wait_for_selector('#toast:has-text("Aviso de teste")'); print('31 aviso de teste:',pg.inner_text('#toast'))
    pg.screenshot(path='shot_empresa2.png',full_page=True)

    pg.click('[data-v=automacao]'); pg.wait_for_selector('#diagatu'); print('32 diagnóstico:',pg.locator('.cf .c').all_inner_texts()[:4]); pg.screenshot(path='shot_diag.png',full_page=True)

    # ---- clientes, pagamento e 2 etapas
    import hmac,hashlib,struct,base64,re as _re
    def totp(sec,off=0):
        k=base64.b32decode(sec.replace(' ','').upper()); c=int(time.time()//30)+off; h=hmac.new(k,struct.pack('>Q',c),hashlib.sha1).digest(); o=h[19]&15
        return f"{(struct.unpack('>I',h[o:o+4])[0]&0x7fffffff)%1000000:06d}"
    pg.click('[data-v=clientes]'); pg.wait_for_selector('#clit'); print('33 clientes já cadastrados sozinhos pelos briefings:',pg.locator('#clit tr td:first-child b').all_inner_texts())
    pg.click('#clinovo'); pg.fill('[data-ck=empresa]','ACME Ltda'); pg.fill('[data-ck=contato_nome]','Ana Lima'); pg.fill('[data-ck=contato_whatsapp]','11 91111-2222'); pg.fill('[data-ck=contato_email]','ana@acme.com'); pg.click('#clisave'); pg.wait_for_selector('#clit td:has-text("ACME Ltda")'); print('34 cliente salvo:',pg.locator('#clit tr:has-text("ACME") td').all_inner_texts()[:4])
    pg.fill('#cbusca','acme'); print('35 busca por "acme" mostra',pg.locator('#clit tr').count(),'linha(s)'); pg.fill('#cbusca','')
    pg.click('text=+ Nova proposta'); pg.select_option('#ncli',label='ACME Ltda'); pg.click('#ncri'); pg.wait_for_selector('#md .g2')
    print('36 proposta nova já preenchida: cliente =',pg.input_value('#md [data-k=cliente]'),'| contato =',pg.input_value('#md [data-k=contato_nome]'),'| whatsapp =',pg.input_value('#md [data-k=contato_whatsapp]'),'| select =',pg.locator('#cli option:checked').inner_text())
    print('37 pagamento padrão no editor: sinal =',pg.input_value('#md [data-k=pag_entrada]'),'| resto =',pg.input_value('#md [data-k=pag_resto_txt]'))
    pg.select_option('#pagpre',value='2'); print('38 modelo "50% + na entrega" -> sinal =',pg.input_value('#md [data-k=pag_entrada]'),'| resto =',pg.input_value('#md [data-k=pag_resto_txt]'))
    pg.click('text=+ Item'); pg.select_option('#I select[data-f=servico]','Captação diária')
    pg.evaluate("enviar()"); pg.wait_for_selector('#msg'); msg2=pg.input_value('#msg'); lk=_re.search(r'https?://\S+',msg2).group(0); print('39 mensagem de envio com o nome do contato:',msg2.split('\n')[0])
    cl2=ctx.new_page(); cl2.goto(lk); cl2.wait_for_selector('.pays'); print('40 página do cliente:',cl2.inner_text('.pays').replace('\n',' | '))
    cl2.screenshot(path='shot_pagamento.png',full_page=True)
    pg.evaluate("fechar()")
    pg.click('[data-v=usuarios]'); pg.wait_for_selector('#tini'); pg.click('#tini'); pg.wait_for_selector('#tcod'); sec=pg.locator('code').first.inner_text(); print('41 chave da 2ª etapa:',sec[:9]+'…')
    pg.fill('#tcod',totp(sec)); pg.click('#tconf'); pg.wait_for_selector('#toff'); print('42 2ª etapa ligada')
    pg.click('text=Sair'); pg.wait_for_selector('#login:not([hidden])'); pg.fill('#lg','admin'); pg.fill('#pin','senha123456'); pg.click('#bentrar'); pg.wait_for_selector('#cod:not([hidden])'); print('43 login só com a senha agora pede o código:',pg.inner_text('#err'))
    pg.fill('#cod',totp(sec)); pg.click('#bentrar'); pg.wait_for_selector('#app:not([hidden])'); print('44 senha + código: entrou')
    pg.click('[data-v=prop]'); pg.wait_for_selector('#tab tr.l'); pg.locator('#tab tr.l td').first.click(); pg.wait_for_selector('#dup'); pg.click('#dup'); pg.wait_for_selector('#toast:has-text("duplicada")'); print('44b duplicar proposta:',pg.inner_text('#md header h3')[:70]); pg.evaluate("fechar(true)")
    # ---- v8.1: aviso de alterações não salvas, validação do envio, campo do iframe
    pg.click('[data-v=empresa]'); pg.wait_for_selector('[data-cf=incorporar_em]'); pg.fill('[data-cf=incorporar_em]','https://propostas.exemplo.workers.dev'); pg.click('#cfsave'); pg.wait_for_selector('#toast:has-text("SEU SITE")'); pg.fill('[data-cf=incorporar_em]',''); print('45 iframe com endereço do sistema é barrado:',pg.inner_text('#toast')[:60])
    pg.click('[data-v=prop]'); pg.click('text=+ Nova proposta'); pg.click('#ncri'); pg.wait_for_selector('#md .g2'); dlg.clear()
    pg.fill('#md [data-k=projeto]','Teste de alteração'); pg.click('#md header .b.g'); pg.wait_for_timeout(300)
    assert any('não salvas' in m for m in dlg), dlg; print('46 fechar com alteração pede confirmação:',dlg[-1]); dlg.clear()
    pg.wait_for_selector('#ov:not([hidden])') if pg.locator('#ov:not([hidden])').count() else pg.locator('#tab tr.l td').first.click()
    pg.evaluate("enviar()"); pg.wait_for_timeout(500)
    assert any('sem itens' in m for m in dlg), dlg; print('47 enviar sem itens pede confirmação:',dlg[-1])
    print('erros JS:',errs); b.close(); srv.kill()
