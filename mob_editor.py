import json,urllib.request,subprocess,time,sys
from playwright.sync_api import sync_playwright
srv=subprocess.Popen(['node','--no-warnings','serve.mjs'],stdout=open('serve.log','w'),stderr=subprocess.STDOUT); time.sleep(2)
B='http://localhost:8799'; shots=len(sys.argv)>1; erros=[]
with sync_playwright() as p:
    b=p.chromium.launch(); ctx=b.new_context(viewport={'width':390,'height':800},device_scale_factor=2,is_mobile=True,has_touch=True); pg=ctx.new_page()
    pg.on('pageerror',lambda e:erros.append(str(e)))
    pg.goto(B+'/painel'); pg.wait_for_selector('#f-setup:not([hidden])')
    pg.fill('#sk','teste-instalacao'); pg.fill('#lg','admin'); pg.fill('#pin','senha123456'); pg.click('#bentrar'); pg.wait_for_selector('#app:not([hidden])')
    k=pg.evaluate("post('/api/chave').then(r=>r.chave)")
    d={"eventId":"e","data":{"responseId":"M1","fields":[{"label":"Nome e Sobrenome","type":"INPUT_TEXT","value":"Maria Souza"},{"label":"Telefone","type":"INPUT_PHONE_NUMBER","value":"+5511900000000"},{"label":"Email","type":"INPUT_EMAIL","value":"maria@rex.com"},{"label":"Organização","type":"INPUT_TEXT","value":"REX RECICLAGEM"},{"label":"Quais produtos ou serviços serão abordados nesta ação?","type":"TEXTAREA","value":"Vídeo institucional"}]}}
    urllib.request.urlopen(urllib.request.Request(B+'/api/tally?k='+k,json.dumps(d).encode(),{'Content-Type':'application/json'}))
    pg.evaluate("carregar()"); pg.wait_for_selector('#tab tr.l'); pg.wait_for_timeout(300)
    if shots: pg.evaluate("document.querySelector('#busca').scrollIntoView()"); pg.wait_for_timeout(200); pg.screenshot(path='m_lista.png')
    ov=lambda: pg.evaluate("[document.documentElement.clientWidth,document.documentElement.scrollWidth]")
    w,sw=ov(); assert sw<=w+1,('lista rola para o lado',w,sw); print('lista sem rolagem lateral:',w,sw)
    pg.evaluate("abrir(S.propostas[0].numero)"); pg.wait_for_selector('#md .g2')
    pg.evaluate("addI();cur.itens[0].servico='Captação diária';cur.itens[0].valor_unit=3500;cur.itens[0].descricao='Equipe e câmera';itens()"); pg.wait_for_timeout(200)
    w,sw=ov(); mw=pg.evaluate("document.querySelector('.md').scrollWidth"); assert sw<=w+1 and mw<=w+1,('editor rola para o lado',w,sw,mw); print('editor sem rolagem lateral:',w,sw,mw)
    peq=pg.evaluate("[...document.querySelectorAll('#md input:not([type=checkbox]),#md select,#md textarea')].filter(e=>e.offsetParent&&parseFloat(getComputedStyle(e).fontSize)<16).length"); assert peq==0,('campos com fonte < 16px (iPhone dá zoom)',peq); print('campos com fonte >= 16px: ok')
    n=pg.evaluate("document.querySelectorAll('#md .atalhos a').length"); assert n==3,n; print('atalhos WhatsApp/Ligar/E-mail:',n)
    bar=pg.evaluate("(()=>{const r=document.querySelector('.act.fix').getBoundingClientRect();return [r.bottom,innerHeight]})()"); assert bar[0]<=bar[1]+1,bar; print('barra de ações visível na tela:',bar)
    if shots:
        pg.screenshot(path='m_editor_topo.png'); pg.evaluate("document.querySelector('#I').scrollIntoView()"); pg.wait_for_timeout(200); pg.screenshot(path='m_editor_itens.png')
    assert not erros,erros; print('erros JS:',erros); b.close()
srv.kill()
